"use strict";

const { getOperationsConnection } = require("../../config/operationsDb");
const { getMasterConnection } = require("../../config/masterDb");
const AppError = require("../../common/AppError");
const { COMPLAINT_STATUS } = require("../../common/constants");
const emailService = require("../../services/email.service");

// Valid status transitions for vendor task updates
const ALLOWED_VENDOR_TRANSITIONS = {
    [COMPLAINT_STATUS.OPEN]: [COMPLAINT_STATUS.IN_PROGRESS],
    [COMPLAINT_STATUS.IN_PROGRESS]: [COMPLAINT_STATUS.RESOLVED],
    // Vendors cannot reopen resolved/closed/rejected tasks
};

// Statuses a task must still be in for a vendor update to be valid at write time
const OPEN_TASK_STATUSES = [COMPLAINT_STATUS.OPEN, COMPLAINT_STATUS.IN_PROGRESS];

class VendorService {

    async getVendorIdForUser(societyId, userId) {
        const opsDb = getOperationsConnection();
        const Vendor = opsDb.model("Vendor");

        const vendor = await Vendor.findOne({ societyId, userId }).lean();
        if (!vendor) {
            throw new AppError("No vendor account linked to this user.", 403, "UNAUTHORIZED_VENDOR_ACCESS");
        }
        if (vendor.status !== "ACTIVE") {
            throw new AppError("Vendor account is inactive.", 403, "VENDOR_INACTIVE");
        }
        return vendor._id;
    }

    // ── Admin CRUD ────────────────────────────────────────────────────────────

    async createVendor(societyId, vendorData, userId) {
        const opsDb = getOperationsConnection();
        const masterDb = getMasterConnection();
        const Vendor = opsDb.model("Vendor");
        const User = opsDb.model("User");
        const UserSocietyMapping = masterDb.model("UserSocietyMapping");
        const InviteToken = masterDb.model("InviteToken");

        // Reject empty / whitespace-only names
        const name = (vendorData.name || "").trim();
        if (!name) {
            throw new AppError("Vendor name cannot be empty.", 400, "INVALID_VENDOR_DATA");
        }

        const email = vendorData.email?.toLowerCase().trim();
        const phone = vendorData.phone?.trim();

        if (!email && !phone) {
            throw new AppError("At least one of email or phone is required to invite a vendor.", 400);
        }

        // Validate contract dates
        if (vendorData.contractStartDate && vendorData.contractEndDate) {
            const start = new Date(vendorData.contractStartDate);
            const end = new Date(vendorData.contractEndDate);
            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                throw new AppError("Invalid contract date format.", 400, "INVALID_VENDOR_DATA");
            }
            if (end < start) {
                throw new AppError("contractEndDate cannot be before contractStartDate.", 400, "INVALID_VENDOR_DATA");
            }
        }

        // Uniqueness checks for User
        const [emailUserExists, phoneUserExists, emailMapped, phoneMapped] = await Promise.all([
            email ? User.findOne({ societyId, email }).lean() : Promise.resolve(null),
            phone ? User.findOne({ societyId, mobile: phone }).lean() : Promise.resolve(null),
            email ? UserSocietyMapping.findOne({ identifier: email, societyId }).lean() : Promise.resolve(null),
            phone ? UserSocietyMapping.findOne({ identifier: phone, societyId }).lean() : Promise.resolve(null),
        ]);

        if (emailUserExists || emailMapped) {
            throw new AppError("This email is already in use in this society.", 409, "EMAIL_EXISTS");
        }
        if (phoneUserExists || phoneMapped) {
            throw new AppError("This phone number is already in use in this society.", 409, "PHONE_EXISTS");
        }

        // Society-scoped uniqueness: same name + serviceCategory within a society
        // NOTE: this is a check-then-act guard only. The real guarantee comes from
        // the unique compound index defined in vendor.model.js — under concurrent
        // requests this findOne can race, but the index will reject the duplicate
        // insert and surface as a Mongo E11000 error (handle that in your global
        // error middleware / map it to VENDOR_ALREADY_EXISTS there too).
        const duplicate = await Vendor.findOne({
            societyId,
            name: { $regex: new RegExp(`^${name}$`, "i") },
            serviceCategory: vendorData.serviceCategory,
        }).lean();
        if (duplicate) {
            throw new AppError("A vendor with this name and category already exists.", 409, "VENDOR_ALREADY_EXISTS");
        }

        const session = await opsDb.startSession();
        let newVendor;
        let plainToken;

        try {
            await session.withTransaction(async () => {
                // Create the User record with status=invited
                // NOTE: verify this literal "vendor" matches ROLES.VENDOR exactly
                // (case-sensitivity) — the vendor-portal routes gate on
                // authorize(ROLES.VENDOR), and a mismatch here will silently lock
                // every invited vendor out of their own portal after activation.
                const newUser = await User.create([{
                    societyId,
                    name,
                    email,
                    mobile: phone,
                    role: "vendor",
                    status: "invited",
                }], { session });

                const newUserId = newUser[0]._id;

                const MappingRepository = require("../userSocietyMapping/userSocietyMapping.repository");
                await MappingRepository.createMappings({
                    societyId,
                    userId: newUserId,
                    email,
                    mobile: phone,
                    roleKeys: ["vendor"],
                    flatId: null,
                });

                // Create InviteToken
                const generated = InviteToken.generateToken();
                plainToken = generated.plainToken;
                const expiresAt = new Date();
                expiresAt.setDate(expiresAt.getDate() + 7);

                await InviteToken.create([{
                    tokenHash: generated.tokenHash,
                    societyId,
                    adminId: newUserId,
                    purpose: "vendor",
                    expiresAt,
                }]);

                // Create Vendor record
                const vendorDocs = await Vendor.create([{
                    ...vendorData,
                    name,
                    societyId,
                    status: "INVITED",
                    userId: newUserId,
                    createdBy: userId,
                    updatedBy: userId,
                }], { session });

                newVendor = vendorDocs[0];
            });
        } finally {
            await session.endSession();
        }

        // Vendor + User + Mapping + InviteToken are already committed at this
        // point. Email delivery is best-effort: a transport failure must NOT
        // make the caller think vendor creation itself failed.
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
        const inviteLink = `${frontendUrl}/activate-account?token=${plainToken}`;
        let emailSent = true;

        try {
            await emailService.sendInviteEmail({
                to: email,
                recipientName: name,
                roleLabel: "Vendor",
                inviteLink,
            });
        } catch (emailError) {
            emailSent = false;
            // eslint-disable-next-line no-console
            console.error(`Failed to send vendor invite email to ${email}:`, emailError);
        }

        if (process.env.NODE_ENV === "development") {
            console.log("\n=============================================");
            console.log("=== DEV VENDOR INVITE LINK ===");
            console.log(`Vendor: ${name} (${email || phone})`);
            console.log(`Link:    ${inviteLink}`);
            console.log("=============================================\n");
        }

        return {
            vendor: newVendor,
            emailSent,
            ...(process.env.NODE_ENV === "development" ? { devInviteLink: inviteLink } : {}),
        };
    }

    async getVendors(societyId, filter = {}) {
        const opsDb = getOperationsConnection();
        const Vendor = opsDb.model("Vendor");

        const query = { societyId, ...filter };
        return Vendor.find(query).sort({ createdAt: -1 }).lean();
    }

    async getVendorById(societyId, vendorId) {
        const opsDb = getOperationsConnection();
        const Vendor = opsDb.model("Vendor");

        const vendor = await Vendor.findOne({ _id: vendorId, societyId }).lean();
        if (!vendor) {
            throw new AppError("Vendor not found.", 404, "VENDOR_NOT_FOUND");
        }
        return vendor;
    }

    async updateVendor(societyId, vendorId, updateData, userId) {
        const opsDb = getOperationsConnection();
        const masterDb = getMasterConnection();
        const Vendor = opsDb.model("Vendor");
        const User = opsDb.model("User");
        const UserSocietyMapping = masterDb.model("UserSocietyMapping");

        // Strip fields that must never be updated by a client
        const { societyId: _sid, createdBy: _cb, userId: _uid, ...safeData } = updateData;

        // Validate name if being updated
        if ("name" in safeData) {
            const name = (safeData.name || "").trim();
            if (!name) {
                throw new AppError("Vendor name cannot be empty.", 400, "INVALID_VENDOR_DATA");
            }
            safeData.name = name;
        }

        // Validate contract dates
        const start = safeData.contractStartDate ? new Date(safeData.contractStartDate) : undefined;
        const end = safeData.contractEndDate ? new Date(safeData.contractEndDate) : undefined;

        if (start && isNaN(start.getTime())) throw new AppError("Invalid contractStartDate.", 400);
        if (end && isNaN(end.getTime())) throw new AppError("Invalid contractEndDate.", 400);
        if (start && end && end < start) {
            throw new AppError("contractEndDate cannot be before contractStartDate.", 400, "INVALID_VENDOR_DATA");
        }

        // Normalize email/phone if present
        if (typeof safeData.email === "string") {
            safeData.email = safeData.email.toLowerCase().trim();
        }
        if (typeof safeData.phone === "string") {
            safeData.phone = safeData.phone.trim();
        }

        const existingVendor = await Vendor.findOne({ _id: vendorId, societyId }).lean();
        if (!existingVendor) {
            throw new AppError("Vendor not found.", 404, "VENDOR_NOT_FOUND");
        }

        const emailChanged = safeData.email && safeData.email !== existingVendor.email;
        const phoneChanged = safeData.phone && safeData.phone !== existingVendor.phone;

        // Uniqueness check when email/phone actually changes (mirrors createVendor)
        if (emailChanged || phoneChanged) {
            const [emailUserExists, phoneUserExists, emailMapped, phoneMapped] = await Promise.all([
                emailChanged
                    ? User.findOne({ societyId, email: safeData.email, _id: { $ne: existingVendor.userId } }).lean()
                    : Promise.resolve(null),
                phoneChanged
                    ? User.findOne({ societyId, mobile: safeData.phone, _id: { $ne: existingVendor.userId } }).lean()
                    : Promise.resolve(null),
                emailChanged
                    ? UserSocietyMapping.findOne({ identifier: safeData.email, societyId, userId: { $ne: existingVendor.userId } }).lean()
                    : Promise.resolve(null),
                phoneChanged
                    ? UserSocietyMapping.findOne({ identifier: safeData.phone, societyId, userId: { $ne: existingVendor.userId } }).lean()
                    : Promise.resolve(null),
            ]);

            if (emailUserExists || emailMapped) {
                throw new AppError("This email is already in use in this society.", 409, "EMAIL_EXISTS");
            }
            if (phoneUserExists || phoneMapped) {
                throw new AppError("This phone number is already in use in this society.", 409, "PHONE_EXISTS");
            }
        }

        safeData.updatedBy = userId;

        const session = await opsDb.startSession();
        let vendor;

        try {
            await session.withTransaction(async () => {
                vendor = await Vendor.findOneAndUpdate(
                    { _id: vendorId, societyId },
                    { $set: safeData },
                    { new: true, runValidators: true, session }
                );

                if (!vendor) {
                    throw new AppError("Vendor not found.", 404, "VENDOR_NOT_FOUND");
                }

                // Keep the linked User record's login-relevant fields in sync so
                // the vendor's credentials never silently diverge from their profile.
                if (existingVendor.userId && (emailChanged || phoneChanged || "name" in safeData)) {
                    const userUpdate = {};
                    if (emailChanged) userUpdate.email = safeData.email;
                    if (phoneChanged) userUpdate.mobile = safeData.phone;
                    if ("name" in safeData) userUpdate.name = safeData.name;

                    await User.findOneAndUpdate(
                        { _id: existingVendor.userId, societyId },
                        { $set: userUpdate },
                        { session }
                    );

                    // Mapping identifiers must follow the new email/phone too
                    if (emailChanged) {
                        await UserSocietyMapping.updateMany(
                            { userId: existingVendor.userId, societyId, identifier: existingVendor.email },
                            { $set: { identifier: safeData.email } },
                            { session }
                        );
                    }
                    if (phoneChanged) {
                        await UserSocietyMapping.updateMany(
                            { userId: existingVendor.userId, societyId, identifier: existingVendor.phone },
                            { $set: { identifier: safeData.phone } },
                            { session }
                        );
                    }
                }
            });
        } finally {
            await session.endSession();
        }

        return vendor;
    }

    async deleteVendor(societyId, vendorId) {
        const opsDb = getOperationsConnection();
        const masterDb = getMasterConnection();

        const Vendor = opsDb.model("Vendor");
        const User = opsDb.model("User");
        const Complaint = opsDb.model("Complaint");
        const Mapping = masterDb.model("UserSocietyMapping");

        const vendor = await Vendor.findOne({ _id: vendorId, societyId });
        if (!vendor) {
            throw new AppError("Vendor not found.", 404, "VENDOR_NOT_FOUND");
        }

        // Block deletion while the vendor still has open/in-progress tasks —
        // otherwise those Complaints are left with a dangling assignedVendorId
        // pointing at a vendor that no longer exists.
        const activeAssignmentCount = await Complaint.countDocuments({
            societyId,
            assignedVendorId: vendorId,
            status: { $in: OPEN_TASK_STATUSES },
        });

        if (activeAssignmentCount > 0) {
            throw new AppError(
                `Cannot delete vendor: ${activeAssignmentCount} active task(s) are still assigned. Reassign or resolve them first.`,
                409,
                "VENDOR_HAS_ACTIVE_ASSIGNMENTS"
            );
        }

        if (vendor.userId) {
            await Mapping.deleteMany({ userId: vendor.userId, societyId });
            await User.deleteOne({ _id: vendor.userId, societyId });
        }

        await Vendor.deleteOne({ _id: vendorId, societyId });
        return true;
    }

    // ── Vendor Eligibility Check ──────────────────────────────────────────────

    _assertVendorEligible(vendor) {
        if (!vendor) {
            throw new AppError("Vendor not found.", 404, "VENDOR_NOT_FOUND");
        }
        if (vendor.status !== "ACTIVE") {
            throw new AppError("Vendor is inactive and cannot receive assignments.", 400, "VENDOR_INACTIVE");
        }

        const now = new Date();

        if (vendor.contractStartDate && new Date(vendor.contractStartDate) > now) {
            throw new AppError(
                "Vendor contract has not started yet.",
                400,
                "VENDOR_CONTRACT_NOT_STARTED"
            );
        }
        if (vendor.contractEndDate && new Date(vendor.contractEndDate) < now) {
            throw new AppError(
                "Vendor contract has expired.",
                400,
                "VENDOR_CONTRACT_EXPIRED"
            );
        }
    }

    // ── Task Assignment (Atomic) ──────────────────────────────────────────────

    /**
     * Fetch all tasks (complaints) for the admin to assign vendors to.
     */
    async getAllTasksForAssignment(societyId) {
        const opsDb = getOperationsConnection();
        const Complaint = opsDb.model("Complaint");

        return Complaint.find({ societyId })
            .populate("assignedVendorId", "name phone email serviceCategory status")
            .populate("raisedBy", "firstName lastName")
            .sort({ createdAt: -1 })
            .lean();
    }

    /**
     * Assign or reassign a complaint/work-order to a vendor.
     * Uses a MongoDB session to ensure atomicity and prevent race conditions.
     */
    async assignTask(societyId, taskId, vendorId, assignedByUserId) {
        const opsDb = getOperationsConnection();
        const Vendor = opsDb.model("Vendor");
        const Complaint = opsDb.model("Complaint");
        const VendorAssignmentHistory = opsDb.model("VendorAssignmentHistory");

        const session = await opsDb.startSession();
        let result;

        try {
            await session.withTransaction(async () => {
                // 1. Fetch & validate the task (society-scoped)
                const task = await Complaint.findOne({ _id: taskId, societyId }).session(session);
                if (!task) {
                    throw new AppError("Task not found.", 404, "TASK_NOT_FOUND");
                }
                if (
                    task.status === COMPLAINT_STATUS.CLOSED ||
                    task.status === COMPLAINT_STATUS.REJECTED
                ) {
                    throw new AppError("Task is already closed.", 400, "TASK_ALREADY_CLOSED");
                }

                // 2. Idempotency — same vendor already assigned
                if (task.assignedVendorId && task.assignedVendorId.toString() === vendorId.toString()) {
                    throw new AppError(
                        "Task is already assigned to this vendor.",
                        400,
                        "ALREADY_ASSIGNED"
                    );
                }

                // 3. Fetch & validate the vendor (society-scoped, re-checks at write time)
                const vendor = await Vendor.findOne({ _id: vendorId, societyId }).session(session);
                this._assertVendorEligible(vendor);

                // 4. Close out the previous assignment history record if there was one
                if (task.assignedVendorId) {
                    await VendorAssignmentHistory.findOneAndUpdate(
                        {
                            societyId,
                            taskId,
                            vendorId: task.assignedVendorId,
                            unassignedAt: null,
                        },
                        {
                            $set: {
                                unassignedBy: assignedByUserId,
                                unassignedAt: new Date(),
                                reason: "Reassigned to another vendor",
                            },
                        },
                        { session, sort: { assignedAt: -1 } }
                    );
                }

                // 5. Atomically update the task
                task.assignedVendorId = vendorId;
                task.vendorAssignedAt = new Date();
                if (task.status === COMPLAINT_STATUS.OPEN) {
                    task.status = COMPLAINT_STATUS.IN_PROGRESS;
                }
                await task.save({ session });

                // 6. Create a new assignment history record
                const history = new VendorAssignmentHistory({
                    societyId,
                    taskId,
                    vendorId,
                    assignedBy: assignedByUserId,
                    assignedAt: new Date(),
                });
                await history.save({ session });

                result = { task, history };
            });
        } finally {
            await session.endSession();
        }

        return result;
    }

    // ── Vendor Portal ─────────────────────────────────────────────────────────

    /**
     * Returns tasks assigned to this vendor (society + vendorId scoped).
     */
    async getVendorTasks(societyId, vendorId) {
        const opsDb = getOperationsConnection();
        const Complaint = opsDb.model("Complaint");

        return Complaint.find({ societyId, assignedVendorId: vendorId })
            .sort({ vendorAssignedAt: -1 })
            .lean();
    }

    /**
     * Returns a single task — enforces double ownership check.
     */
    async getVendorTaskById(societyId, vendorId, taskId) {
        const opsDb = getOperationsConnection();
        const Complaint = opsDb.model("Complaint");

        const task = await Complaint.findOne({
            _id: taskId,
            societyId,
            assignedVendorId: vendorId,
        }).lean();

        if (!task) {
            throw new AppError(
                "Task not found or not assigned to you.",
                403,
                "TASK_NOT_ASSIGNED_TO_VENDOR"
            );
        }
        return task;
    }

    async updateVendorTask(societyId, vendorId, taskId, updateData) {
        const opsDb = getOperationsConnection();
        const Complaint = opsDb.model("Complaint");

        // Fetch current task to validate transition
        const current = await Complaint.findOne({
            _id: taskId,
            societyId,
            assignedVendorId: vendorId,
        });

        if (!current) {
            throw new AppError(
                "This task is no longer assigned to you.",
                403,
                "TASK_NO_LONGER_ASSIGNED"
            );
        }

        // Closed-task protection
        if (
            current.status === COMPLAINT_STATUS.CLOSED ||
            current.status === COMPLAINT_STATUS.REJECTED
        ) {
            throw new AppError("Cannot modify a closed task.", 400, "TASK_ALREADY_CLOSED");
        }

        // Status transition validation
        const allowedUpdates = {};

        if (updateData.status) {
            const allowed = ALLOWED_VENDOR_TRANSITIONS[current.status] || [];
            if (!allowed.includes(updateData.status)) {
                throw new AppError(
                    `Invalid status transition: ${current.status} → ${updateData.status}`,
                    400,
                    "INVALID_STATE_TRANSITION"
                );
            }
            allowedUpdates.status = updateData.status;
            if (updateData.status === COMPLAINT_STATUS.RESOLVED) {
                allowedUpdates.resolvedAt = new Date();
            }
        }

        if (updateData.remarks !== undefined) {
            allowedUpdates.remarks = updateData.remarks;
        }

        // FIX: the original filter only re-checked societyId + assignedVendorId,
        // so a task closed/rejected by an admin between the read above and this
        // write could still be silently updated by the vendor. Re-assert the
        // task is still in an open status at write time too.
        const updated = await Complaint.findOneAndUpdate(
            {
                _id: taskId,
                societyId,
                assignedVendorId: vendorId,
                status: { $in: OPEN_TASK_STATUSES },
            },
            { $set: allowedUpdates },
            { new: true, runValidators: true }
        );

        if (!updated) {
            // Task was reassigned or closed between the read and write — race condition caught
            throw new AppError(
                "This task is no longer assigned to you or is no longer open.",
                403,
                "TASK_NO_LONGER_ASSIGNED"
            );
        }

        return updated;
    }

    // ── Vendor History & Reporting ────────────────────────────────────────────

    async getVendorHistory(societyId, vendorId) {
        const opsDb = getOperationsConnection();
        const VendorAssignmentHistory = opsDb.model("VendorAssignmentHistory");

        return VendorAssignmentHistory.find({ societyId, vendorId })
            .sort({ assignedAt: -1 })
            .populate("taskId", "title status category priority createdAt resolvedAt")
            .populate("assignedBy", "firstName lastName email")
            .populate("unassignedBy", "firstName lastName email")
            .lean();
    }
}

module.exports = new VendorService();