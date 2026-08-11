"use strict";

const { getMasterConnection } = require("../../config/masterDb");
const { getOperationsConnection } = require("../../config/operationsDb");
const userSchema = require("../user/user.model");

/**
 * AuthRepository
 *
 * Handles all DB interactions for authentication.
 * After migration to the shared-collection model:
 *   - Identifier → societyId lookups go to mysociety_master.usersocietymappings
 *   - User lookups go to mysociety_operations.users (always scoped by societyId)
 *   - No tenantDb parameter — the ops connection is always the same connection
 */
class AuthRepository {
    /**
     * Looks up which society a login identifier (email/mobile) belongs to.
     * Returns an array of matching mappings (a person may belong to multiple societies).
     *
     * @param {string} identifier — email or mobile
     * @returns {Promise<Array>} — array of { societyId, userId }
     */
    async getMappingsForIdentifier(identifier) {
        const masterDb = getMasterConnection();
        const Mapping = masterDb.model("UserSocietyMapping");
        return Mapping.find({ identifier: identifier.toLowerCase().trim() })
            .lean();
    }

    /**
     * Finds a society in the master DB by its ObjectId.
     * Used to verify the society exists and is active before login.
     */
    async getSocietyById(societyId) {
        const masterDb = getMasterConnection();
        const Society = masterDb.model("Society");
        return Society.findOne({ _id: societyId, status: "active" }).lean();
    }

    /**
     * Finds a user in the shared operations DB by identifier (email OR mobile)
     * scoped to a specific society.
     *
     * SECURITY: societyId MUST come from the server-resolved mapping, never from request input.
     *
     * @param {ObjectId|string} societyId
     * @param {string} identifier — email or mobile
     */
    async findUserByIdentifier(societyId, identifier) {
        const opsDb = getOperationsConnection();
        const User = opsDb.model("User");
        return User.findOne({
            societyId,
            $or: [
                { email: identifier.toLowerCase().trim() },
                { mobile: identifier.trim() }
            ]
        }).select("+password +refreshToken");
    }

    /**
     * Finds a Super Admin in the master DB by email.
     */
    async findSuperAdminByEmail(email) {
        const masterDb = getMasterConnection();
        const SuperAdmin = masterDb.model("SuperAdmin");
        return SuperAdmin.findOne({ email: email.toLowerCase().trim() }).select("+password");
    }

    /**
     * Finds a Super Admin in the master DB by ID.
     */
    async findSuperAdminById(adminId) {
        const masterDb = getMasterConnection();
        const SuperAdmin = masterDb.model("SuperAdmin");
        return SuperAdmin.findById(adminId);
    }

    /**
     * Finds a user by their MongoDB _id, scoped to the given society.
     */
    async findUserById(societyId, userId) {
        const opsDb = getOperationsConnection();
        const User = opsDb.model("User");
        return User.findOne({ _id: userId, societyId });
    }

    /**
     * Saves a new refresh token (and updates lastLogin timestamp) for a user.
     */
    async saveRefreshToken(userId, refreshToken) {
        const opsDb = getOperationsConnection();
        const User = opsDb.model("User");
        return User.findByIdAndUpdate(userId, { refreshToken, lastLogin: new Date() });
    }

    /**
     * Clears the refresh token for a user (used on logout).
     */
    async clearRefreshToken(userId) {
        const opsDb = getOperationsConnection();
        const User = opsDb.model("User");
        return User.findByIdAndUpdate(userId, { $unset: { refreshToken: 1 } });
    }

    /**
     * Saves a new refresh token (and updates lastLogin timestamp) for a Super Admin.
     */
    async saveSuperAdminRefreshToken(adminId, refreshToken) {
        const masterDb = getMasterConnection();
        const SuperAdmin = masterDb.model("SuperAdmin");
        return SuperAdmin.findByIdAndUpdate(adminId, { refreshToken, lastLogin: new Date() });
    }

    /**
     * Clears the refresh token for a Super Admin (used on logout).
     */
    async clearSuperAdminRefreshToken(adminId) {
        const masterDb = getMasterConnection();
        const SuperAdmin = masterDb.model("SuperAdmin");
        return SuperAdmin.findByIdAndUpdate(adminId, { $unset: { refreshToken: 1 } });
    }
}

module.exports = new AuthRepository();
