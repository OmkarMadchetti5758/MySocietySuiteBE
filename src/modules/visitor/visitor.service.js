"use strict";

const { getOperationsConnection } = require("../../config/operationsDb");
const { getMasterConnection } = require("../../config/masterDb");
const AppError = require("../../common/AppError");
const { getIO } = require("../../config/socket");
const { VISITOR_STATUS, QR_PASS_STATUS } = require("../../common/constants");

class VisitorService {
    async addWalkInVisitor(data) {
        const opsDb = getOperationsConnection();
        const masterDb = getMasterConnection();
        const VisitorEntry = opsDb.model("VisitorEntry");

        const entry = await VisitorEntry.create({
            societyId: data.societyId,
            flatId: data.flatId,
            visitorName: data.visitorName,
            visitorMobile: data.visitorMobile,
            purposeOfVisit: data.purposeOfVisit,
            vehicleNumber: data.vehicleNumber,
            category: data.category,
            gateId: data.gateId,
            guardId: data.guardId,
            photo: data.photo,
            status: VISITOR_STATUS.PENDING
        });

        // Notify all residents of the flat via socket
        // Residents are stored in UserSocietyMapping (master DB) with flatId + resident roleKey
        try {
            const Mapping = masterDb.model("UserSocietyMapping");
            const residentMappings = await Mapping.find({
                societyId: data.societyId,
                flatId: data.flatId,
                status: "active",
                roleKeys: { $in: ["resident_owner", "resident_tenant"] }
            }).lean();

            const io = getIO();
            if (residentMappings && residentMappings.length > 0) {
                residentMappings.forEach(mapping => {
                    if (mapping.userId) {
                        io.to(`user_${mapping.userId.toString()}`).emit("visitor-approval-request", entry);
                    }
                });
            }
        } catch (notifyErr) {
            // Non-blocking: log but don't fail the entry creation
            console.error("[VisitorService] Failed to notify residents:", notifyErr.message);
        }

        return entry;
    }

    async approveVisitor(entryId, societyId, residentId, status) {
        const opsDb = getOperationsConnection();
        const VisitorEntry = opsDb.model("VisitorEntry");

        const entry = await VisitorEntry.findOne({ _id: entryId, societyId });
        if (!entry) throw new AppError("Visitor entry not found", 404);

        if (entry.status !== VISITOR_STATUS.PENDING) {
            throw new AppError(`Visitor is already ${entry.status}`, 400);
        }

        entry.status = status; // approved or rejected
        entry.approvedBy = residentId;
        
        if (status === VISITOR_STATUS.APPROVED) {
            entry.status = VISITOR_STATUS.CHECKED_IN; // Fast track check-in
        }

        await entry.save();

        const io = getIO();
        // Notify guard at the gate and anyone tracking this specific entry
        if (entry.gateId) {
            io.to(`gate_${entry.gateId.toString()}`).emit("visitor-status-updated", entry);
        }
        io.to(`entry_${entry._id.toString()}`).emit("visitor-status-updated", entry);

        return entry;
    }

    async createQrPass(data, residentId, societyId) {
        const opsDb = getOperationsConnection();
        const QRDigitalPass = opsDb.model("QRDigitalPass");

        // Generate unique passCode e.g. "MSS-QR-XXXXXXXX"
        const uniqueSuffix = Math.random().toString(36).substring(2, 8).toUpperCase() + Date.now().toString(36).toUpperCase();
        const passCode = `MSS-PASS-${uniqueSuffix}`;

        const qrPass = await QRDigitalPass.create({
            societyId,
            flatId: data.flatId,
            residentId,
            visitorName: data.visitorName,
            visitorMobile: data.visitorMobile,
            type: data.type || QR_PASS_TYPE.ONE_TIME,
            validFrom: data.validFrom ? new Date(data.validFrom) : new Date(),
            validTo: data.validTo ? new Date(data.validTo) : new Date(Date.now() + 24 * 60 * 60 * 1000),
            validDays: data.validDays || [],
            timeWindowStart: data.timeWindowStart || null,
            timeWindowEnd: data.timeWindowEnd || null,
            passCode,
            status: QR_PASS_STATUS.ACTIVE,
            isUsed: false
        });

        return qrPass;
    }

    async getMyQrPasses(residentId, societyId, flatId) {
        const opsDb = getOperationsConnection();
        const QRDigitalPass = opsDb.model("QRDigitalPass");

        const query = { societyId };
        if (flatId) {
            query.flatId = flatId;
        } else if (residentId) {
            query.residentId = residentId;
        }

        const passes = await QRDigitalPass.find(query)
            .sort({ createdAt: -1 })
            .lean();

        return passes;
    }

    async revokeQrPass(passId, residentId, societyId) {
        const opsDb = getOperationsConnection();
        const QRDigitalPass = opsDb.model("QRDigitalPass");

        const pass = await QRDigitalPass.findOne({ _id: passId, societyId });
        if (!pass) throw new AppError("QR Pass not found", 404);

        pass.status = QR_PASS_STATUS.REVOKED;
        await pass.save();

        return pass;
    }

    async validateQrPass(qrCode, gateId, societyId, guardId) {
        const opsDb = getOperationsConnection();
        const QRDigitalPass = opsDb.model("QRDigitalPass");
        const VisitorEntry = opsDb.model("VisitorEntry");
        
        const qrPass = await QRDigitalPass.findOne({ passCode: qrCode, societyId }).populate("flatId");
        if (!qrPass) {
            const err = new AppError("Invalid QR Code: Pass not found in system", 404);
            err.errorCode = "QR_NOT_FOUND";
            throw err;
        }

        const now = new Date();

        // 1. Check if revoked
        if (qrPass.status === QR_PASS_STATUS.REVOKED) {
            const err = new AppError("QR Pass has been Revoked by Resident", 400);
            err.errorCode = "QR_REVOKED";
            err.qrPass = qrPass;
            throw err;
        }

        // 2. Check if expired by date
        if (qrPass.status === QR_PASS_STATUS.EXPIRED || now > new Date(qrPass.validTo) || now < new Date(qrPass.validFrom)) {
            qrPass.status = QR_PASS_STATUS.EXPIRED;
            await qrPass.save();
            const err = new AppError("QR Pass Expired: Date validity has passed", 400);
            err.errorCode = "QR_EXPIRED";
            err.qrPass = qrPass;
            throw err;
        }

        // 3. One-time pass: check if already used
        if (qrPass.type === "one_time" && (qrPass.isUsed || qrPass.status === QR_PASS_STATUS.USED)) {
            const err = new AppError("QR Pass Already Used: One-time passes cannot be reused", 400);
            err.errorCode = "QR_ALREADY_USED";
            err.qrPass = qrPass;
            throw err;
        }

        // 4. Recurring pass: check valid days of week
        if (qrPass.type === "recurring" && qrPass.validDays && qrPass.validDays.length > 0) {
            const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
            const currentDay = dayNames[now.getDay()];
            if (!qrPass.validDays.includes(currentDay)) {
                const err = new AppError(`QR Pass Invalid Today: Pass is only valid on ${qrPass.validDays.join(", ")}`, 400);
                err.errorCode = "QR_INVALID_DAY";
                err.qrPass = qrPass;
                throw err;
            }
        }

        // 5. Check time window (e.g. 08:00 - 11:00)
        if (qrPass.timeWindowStart && qrPass.timeWindowEnd) {
            const currentHours = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');
            if (currentHours < qrPass.timeWindowStart || currentHours > qrPass.timeWindowEnd) {
                const err = new AppError(`Outside Valid Time Window: Pass is only valid between ${qrPass.timeWindowStart} and ${qrPass.timeWindowEnd}`, 400);
                err.errorCode = "QR_OUTSIDE_TIME";
                err.qrPass = qrPass;
                throw err;
            }
        }

        // Mark used if one_time
        if (qrPass.type === "one_time") {
            qrPass.isUsed = true;
            qrPass.status = QR_PASS_STATUS.USED;
            await qrPass.save();
        }

        // Auto-approve and log entry
        const entry = await VisitorEntry.create({
            societyId: qrPass.societyId,
            flatId: qrPass.flatId?._id || qrPass.flatId,
            visitorName: qrPass.visitorName,
            visitorMobile: qrPass.visitorMobile,
            category: qrPass.type === "recurring" ? "service" : "guest",
            gateId: gateId || null,
            guardId: guardId || null,
            isQrPass: true,
            qrPassId: qrPass._id,
            status: VISITOR_STATUS.CHECKED_IN,
            approvedBy: qrPass.residentId
        });

        return { qrPass, entry };
    }

    async getPendingVisitors(societyId, flatId) {
        const opsDb = getOperationsConnection();
        const VisitorEntry = opsDb.model("VisitorEntry");

        const query = { societyId, status: VISITOR_STATUS.PENDING };
        if (flatId) {
            query.flatId = flatId;
        }

        const entries = await VisitorEntry.find(query)
            .sort({ createdAt: -1 })
            .lean();

        return entries;
    }

    async getVisitorHistory(societyId, filters = {}) {
        const opsDb = getOperationsConnection();
        const VisitorEntry = opsDb.model("VisitorEntry");

        const query = { societyId };
        if (filters.status) query.status = filters.status;
        if (filters.flatId) query.flatId = filters.flatId;
        if (filters.category) query.category = filters.category;

        const entries = await VisitorEntry.find(query)
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();

        return entries;
    }

    async getVisitorById(entryId, societyId) {
        const opsDb = getOperationsConnection();
        const VisitorEntry = opsDb.model("VisitorEntry");

        const entry = await VisitorEntry.findOne({ _id: entryId, societyId }).lean();
        if (!entry) throw new AppError("Visitor entry not found", 404);

        return entry;
    }
}
module.exports = new VisitorService();
