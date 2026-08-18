"use strict";

const { getOperationsConnection } = require("../../config/operationsDb");
const { getMasterConnection }     = require("../../config/masterDb");

class ManagerAssignmentRepository {
    _opsDb()    { return getOperationsConnection(); }
    _masterDb() { return getMasterConnection(); }

    // ── Read ───────────────────────────────────────────────────────────────────

    /**
     * Get all assignments for a society, with optional filters.
     * Returns all department-head assignments regardless of status,
     * so the caller can merge "Unassigned" placeholders.
     *
     * @param {string} societyId
     * @param {{ department?: string, status?: string, search?: string }} filters
     * @returns {Array}
     */
    async listAssignments(societyId, { department, status, search } = {}) {
        const opsDb = this._opsDb();
        const ManagerAssignment = opsDb.model("ManagerAssignment");

        const filter = { societyId };
        if (department) filter.department = department;
        if (status)     filter.status     = status;

        if (search) {
            const rx = { $regex: search, $options: "i" };
            filter.$or = [
                { managerName:  rx },
                { managerEmail: rx },
                { managerPhone: rx },
            ];
        }

        return ManagerAssignment.find(filter).sort({ createdAt: -1 }).lean();
    }

    /**
     * Get the active (or invite_pending) assignment for a specific role in a society.
     * Used for single-holder duplicate check.
     */
    async getActiveAssignmentForRole(societyId, roleKey) {
        const opsDb = this._opsDb();
        const ManagerAssignment = opsDb.model("ManagerAssignment");
        return ManagerAssignment.findOne({
            societyId,
            roleKey,
            status: { $in: ["active", "invite_pending"] },
        }).lean();
    }

    /**
     * Get a specific assignment by ID.
     */
    async getById(societyId, assignmentId) {
        const opsDb = this._opsDb();
        const ManagerAssignment = opsDb.model("ManagerAssignment");
        return ManagerAssignment.findOne({ _id: assignmentId, societyId }).lean();
    }

    /**
     * Check if a user is already assigned to this specific role (duplicate guard).
     */
    async checkDuplicateRoleAssignment(societyId, userId, roleKey) {
        const opsDb = this._opsDb();
        const ManagerAssignment = opsDb.model("ManagerAssignment");
        return ManagerAssignment.findOne({
            societyId,
            userId,
            roleKey,
            status: { $in: ["active", "invite_pending"] },
        }).lean();
    }

    // ── Write ──────────────────────────────────────────────────────────────────

    /**
     * Create a new manager assignment record.
     * @param {Object} data - fields matching managerAssignmentSchema
     * @returns {Object} created document
     */
    async createAssignment(data) {
        const opsDb = this._opsDb();
        const ManagerAssignment = opsDb.model("ManagerAssignment");
        const doc = await ManagerAssignment.create(data);
        return doc.toObject();
    }

    /**
     * Update an assignment by ID.
     */
    async updateAssignment(societyId, assignmentId, updates) {
        const opsDb = this._opsDb();
        const ManagerAssignment = opsDb.model("ManagerAssignment");
        return ManagerAssignment.findOneAndUpdate(
            { _id: assignmentId, societyId },
            { $set: updates },
            { new: true, runValidators: true }
        ).lean();
    }

    // ── UserSocietyMapping helpers ─────────────────────────────────────────────

    /**
     * Add a roleKey to the UserSocietyMapping entries for a user's identifiers.
     * Used when promoting a resident (Path A) or activating a new manager (Path B).
     *
     * @param {string} societyId
     * @param {string} userId
     * @param {string} roleKey
     */
    async addRoleKeyToMapping(societyId, userId, roleKey) {
        const masterDb = this._masterDb();
        const UserSocietyMapping = masterDb.model("UserSocietyMapping");
        await UserSocietyMapping.updateMany(
            { societyId, userId },
            { $addToSet: { roleKeys: roleKey } }
        );
    }

    /**
     * Remove a roleKey from the UserSocietyMapping entries for a user.
     * Used when deactivating a manager.
     */
    async removeRoleKeyFromMapping(societyId, userId, roleKey) {
        const masterDb = this._masterDb();
        const UserSocietyMapping = masterDb.model("UserSocietyMapping");
        await UserSocietyMapping.updateMany(
            { societyId, userId },
            { $pull: { roleKeys: roleKey } }
        );
    }

    /**
     * Create UserSocietyMapping entries for a brand-new manager user (Path B).
     * Called after user + assignment records are created.
     */
    async createMappingForNewManager(societyId, userId, roleKey, email, phone) {
        const masterDb = this._masterDb();
        const UserSocietyMapping = masterDb.model("UserSocietyMapping");

        const entries = [];
        if (email) {
            entries.push({
                identifier: email.toLowerCase().trim(),
                societyId,
                userId,
                roleKeys: [roleKey],
                flatId: null,
            });
        } else if (phone) {
            entries.push({
                identifier: phone.trim(),
                societyId,
                userId,
                roleKeys: [roleKey],
                flatId: null,
            });
        }
        if (entries.length > 0) {
            await UserSocietyMapping.insertMany(entries, { ordered: false });
        }
    }

    // ── Resident lookup (for Path A search) ───────────────────────────────────

    /**
     * Search residents in a society by name, email, or phone for the Path A selector.
     * Excludes already-deactivated / moved-out residents.
     *
     * @param {string} societyId
     * @param {string} query
     * @param {number} limit
     * @returns {Array}
     */
    async searchResidents(societyId, query, limit = 20) {
        const opsDb = this._opsDb();
        const User     = opsDb.model("User");
        const Resident = opsDb.model("Resident");
        const Flat     = opsDb.model("Flat");

        const residentRoles = ["resident_owner", "resident_tenant", "resident"];
        const filter = {
            societyId,
            role: { $in: residentRoles },
            isActive: true,
        };

        if (query) {
            const rx = { $regex: query, $options: "i" };
            filter.$or = [{ name: rx }, { email: rx }, { mobile: rx }];
        }

        const users = await User.find(filter).limit(limit).lean();
        const userIds = users.map((u) => u._id);

        const residents = await Resident.find({ societyId, userId: { $in: userIds }, isActive: true }).lean();
        const flatIds   = residents.map((r) => r.flatId).filter(Boolean);
        const flats     = await Flat.find({ _id: { $in: flatIds } }).lean();

        const flatMap     = Object.fromEntries(flats.map((f) => [f._id.toString(), f]));
        const residentMap = Object.fromEntries(residents.map((r) => [r.userId.toString(), r]));

        return users.map((u) => {
            const resident = residentMap[u._id.toString()];
            const flat     = resident ? flatMap[resident.flatId?.toString()] : null;
            return {
                _id:        u._id,
                name:       u.name,
                email:      u.email,
                mobile:     u.mobile,
                status:     u.status,
                isActive:   u.isActive,
                flatNumber: flat?.flatNumber || null,
                residentType: resident?.residentType || null,
            };
        });
    }

    // ── Invite Token helpers ───────────────────────────────────────────────────

    /**
     * Mark all unused invite tokens for a user as used (invalidation).
     * Called on resend or admin cancellation.
     */
    async invalidateExistingInvites(userId) {
        const masterDb = this._masterDb();
        const InviteToken = masterDb.model("InviteToken");
        await InviteToken.updateMany(
            { adminId: userId, used: false },
            { $set: { used: true } }
        );
    }

    /**
     * Create a new invite token for a manager (7-day expiry).
     * @returns {{ plainToken: string }}
     */
    async createManagerInviteToken(societyId, userId) {
        const masterDb = this._masterDb();
        const InviteToken = masterDb.model("InviteToken");

        const { plainToken, tokenHash } = InviteToken.generateToken();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // 7-day window

        await InviteToken.create({
            tokenHash,
            societyId,
            adminId:  userId,
            purpose:  "manager",
            expiresAt,
        });

        return { plainToken };
    }

    /**
     * Update OTP verification flags on the invite token.
     * Used when manager completes OTP so they can resume without re-verifying.
     */
    async markInviteOtpVerified(userId, channel) {
        const masterDb = this._masterDb();
        const InviteToken = masterDb.model("InviteToken");
        const update = {};
        if (channel === "email") update.otpEmailVerified = true;
        if (channel === "phone") update.otpPhoneVerified = true;
        await InviteToken.updateOne(
            { adminId: userId, used: false, purpose: "manager" },
            { $set: update }
        );
    }

    // ── permissionsVersion bump ────────────────────────────────────────────────

    async bumpPermissionsVersion(societyId) {
        const masterDb = this._masterDb();
        const Society  = masterDb.model("Society");
        const { bustPermissionsVersionCache } = require("../../common/permissionsVersionCache");
        await Society.updateOne({ _id: societyId }, { $inc: { permissionsVersion: 1 } });
        bustPermissionsVersionCache(societyId);
    }
}

module.exports = new ManagerAssignmentRepository();
