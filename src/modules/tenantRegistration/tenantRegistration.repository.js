"use strict";

const { getOperationsConnection } = require("../../config/operationsDb");
const AppError = require("../../common/AppError");
const { TENANT_ERRORS } = require("./tenantRegistration.constants");

class TenantRegistrationRepository {
    /**
     * Find flats where the given user is the primaryOwner AND the flat is Vacant.
     */
    async findEligibleFlats(societyId, ownerId) {
        const opsDb = getOperationsConnection();
        const Flat = opsDb.model("Flat");

        return Flat.find({
            societyId,
            primaryOwner: ownerId,
            occupancyStatus: "Vacant",
            isActive: true,
        }).lean();
    }

    /**
     * Find all flats owned by the user (or all flats if admin).
     * Used for tenancy history dropdown and flat lookups.
     */
    async findOwnerFlats(societyId, ownerId, isAdmin) {
        const opsDb = getOperationsConnection();
        const Flat = opsDb.model("Flat");
        const Resident = opsDb.model("Resident");
        const TenantRegistration = opsDb.model("TenantRegistration");

        if (isAdmin) {
            return Flat.find({ societyId, isActive: true }).sort({ flatNumber: 1 }).lean();
        }

        // Union: primaryOwner, resident owner records, or owner from past registrations
        const [residentRecords, tenantFlats] = await Promise.all([
            Resident.find({ societyId, userId: ownerId, residentType: "owner" }).select("flatId").lean(),
            TenantRegistration.find({ societyId, ownerId }).distinct("flatId"),
        ]);

        const extraFlatIds = [
            ...residentRecords.map((r) => r.flatId),
            ...tenantFlats,
        ].filter(Boolean);

        return Flat.find({
            societyId,
            isActive: true,
            $or: [
                { primaryOwner: ownerId },
                { _id: { $in: extraFlatIds } },
            ],
        }).sort({ flatNumber: 1 }).lean();
    }

    /**
     * Find an active TenantRegistration for a given flat.
     */
    async findActiveTenancyForFlat(societyId, flatId) {
        const opsDb = getOperationsConnection();
        const TenantRegistration = opsDb.model("TenantRegistration");

        return TenantRegistration.findOne({
            societyId,
            flatId,
            status: "Active",
        }).lean();
    }

    /**
     * Create a new TenantRegistration document.
     */
    async createTenantRegistration(societyId, data) {
        const opsDb = getOperationsConnection();
        const TenantRegistration = opsDb.model("TenantRegistration");

        return TenantRegistration.create({ societyId, ...data });
    }

    /**
     * Paginate tenant registrations filtered by ownerId.
     */
    async getPaginatedByOwner(societyId, ownerId, page, limit, search, statusFilter) {
        const opsDb = getOperationsConnection();
        const TenantRegistration = opsDb.model("TenantRegistration");
        const Block = opsDb.model("Block");

        const filter = { societyId, ownerId };
        if (statusFilter) filter.status = statusFilter;
        if (search) {
            const regex = { $regex: search, $options: "i" };
            filter.$or = [{ fullName: regex }, { email: regex }, { mobileNumber: regex }];
        }

        const skip = (page - 1) * limit;

        const [records, total, blockDoc] = await Promise.all([
            TenantRegistration.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate("tenantUserId", "name email mobile role status")
                .populate("flatId", "flatNumber blockId occupancyStatus")
                .populate("ownerId", "name email mobile")
                .lean(),
            TenantRegistration.countDocuments(filter),
            Block.findOne({ societyId }).lean(),
        ]);

        const wingMap = Object.fromEntries(
            (blockDoc?.wings || []).map((w) => [w._id.toString(), w])
        );

        const enrichedRecords = records.map((record) => {
            const flatBlockId = record.flatId?.blockId?.toString();
            const wing = flatBlockId ? wingMap[flatBlockId] : null;
            return {
                ...record,
                wing: wing?.name || wing?.code || "Wing",
                wingName: wing?.name || null,
                wingCode: wing?.code || null,
                flatNumber: record.flatId?.flatNumber || "",
                ownerName: record.ownerId?.name || "",
            };
        });

        return {
            records: enrichedRecords,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 1,
        };
    }

    /**
     * Paginate all tenant registrations for a society (admin view).
     */
    async getAllPaginated(societyId, page, limit, search, statusFilter) {
        const opsDb = getOperationsConnection();
        const TenantRegistration = opsDb.model("TenantRegistration");
        const Block = opsDb.model("Block");

        const filter = { societyId };
        if (statusFilter) filter.status = statusFilter;
        if (search) {
            const regex = { $regex: search, $options: "i" };
            filter.$or = [{ fullName: regex }, { email: regex }, { mobileNumber: regex }];
        }

        const skip = (page - 1) * limit;

        const [records, total, blockDoc] = await Promise.all([
            TenantRegistration.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate("tenantUserId", "name email mobile role status")
                .populate("flatId", "flatNumber blockId occupancyStatus")
                .populate("ownerId", "name email mobile")
                .lean(),
            TenantRegistration.countDocuments(filter),
            Block.findOne({ societyId }).lean(),
        ]);

        const wingMap = Object.fromEntries(
            (blockDoc?.wings || []).map((w) => [w._id.toString(), w])
        );

        const enrichedRecords = records.map((record) => {
            const flatBlockId = record.flatId?.blockId?.toString();
            const wing = flatBlockId ? wingMap[flatBlockId] : null;
            return {
                ...record,
                wing: wing?.name || wing?.code || "Wing",
                wingName: wing?.name || null,
                wingCode: wing?.code || null,
                flatNumber: record.flatId?.flatNumber || "",
                ownerName: record.ownerId?.name || "",
            };
        });

        return {
            records: enrichedRecords,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 1,
        };
    }

    /**
     * Get a single TenantRegistration by id + societyId.
     */
    async getById(societyId, id) {
        const opsDb = getOperationsConnection();
        const TenantRegistration = opsDb.model("TenantRegistration");
        const Block = opsDb.model("Block");

        const [record, blockDoc] = await Promise.all([
            TenantRegistration.findOne({ _id: id, societyId })
                .populate("tenantUserId", "name email mobile role status")
                .populate("flatId", "flatNumber blockId occupancyStatus")
                .populate("ownerId", "name email mobile")
                .lean(),
            Block.findOne({ societyId }).lean(),
        ]);

        if (!record) return null;

        const wingMap = Object.fromEntries(
            (blockDoc?.wings || []).map((w) => [w._id.toString(), w])
        );
        const flatBlockId = record.flatId?.blockId?.toString();
        const wing = flatBlockId ? wingMap[flatBlockId] : null;

        return {
            ...record,
            wing: wing?.name || wing?.code || "Wing",
            wingName: wing?.name || null,
            wingCode: wing?.code || null,
            flatNumber: record.flatId?.flatNumber || "",
            ownerName: record.ownerId?.name || "",
        };
    }

    /**
     * Get all registration records for a flat (full history), sorted newest first.
     */
    async getTenantsByFlat(societyId, flatId) {
        const opsDb = getOperationsConnection();
        const TenantRegistration = opsDb.model("TenantRegistration");
        const Block = opsDb.model("Block");

        const [records, blockDoc] = await Promise.all([
            TenantRegistration.find({ societyId, flatId })
                .sort({ createdAt: -1 })
                .populate("tenantUserId", "name email mobile role status")
                .populate("flatId", "flatNumber blockId occupancyStatus")
                .populate("ownerId", "name email mobile")
                .lean(),
            Block.findOne({ societyId }).lean(),
        ]);

        const wingMap = Object.fromEntries(
            (blockDoc?.wings || []).map((w) => [w._id.toString(), w])
        );

        return records.map((record) => {
            const flatBlockId = record.flatId?.blockId?.toString();
            const wing = flatBlockId ? wingMap[flatBlockId] : null;
            return {
                ...record,
                wing: wing?.name || wing?.code || "Wing",
                wingName: wing?.name || null,
                wingCode: wing?.code || null,
                flatNumber: record.flatId?.flatNumber || "",
                ownerName: record.ownerId?.name || "",
            };
        });
    }

    /**
     * Update the status (and optionally moveOutDate) of a registration.
     */
    async updateStatus(societyId, id, status, moveOutDate) {
        const opsDb = getOperationsConnection();
        const TenantRegistration = opsDb.model("TenantRegistration");

        const updateData = { status };
        if (status === "Vacated" && moveOutDate) {
            updateData.moveOutDate = moveOutDate;
        }

        return TenantRegistration.findOneAndUpdate(
            { _id: id, societyId },
            { $set: updateData },
            { new: true, runValidators: true }
        );
    }

    /**
     * Update editable fields (excluding documents).
     */
    async updateRegistration(societyId, id, data) {
        const opsDb = getOperationsConnection();
        const TenantRegistration = opsDb.model("TenantRegistration");

        // Strip documents from update to prevent accidental overwrite
        const { documents, ...safeData } = data;

        return TenantRegistration.findOneAndUpdate(
            { _id: id, societyId },
            { $set: safeData },
            { new: true, runValidators: true }
        );
    }
}

module.exports = new TenantRegistrationRepository();
