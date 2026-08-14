"use strict";

const { getMasterConnection } = require("../../config/masterDb");
const { resolveRoleKey } = require("../../common/permissionResolver");

/**
 * UserSocietyMappingRepository
 *
 * Keeps login mappings in sync with user.role and supports dual-role users via roleKeys[].
 */
class UserSocietyMappingRepository {
    _getModel() {
        return getMasterConnection().model("UserSocietyMapping");
    }

    /**
     * Create identifier mappings for a user (email and/or mobile).
     */
    async createMappings({ societyId, userId, email, mobile, roleKeys, flatId = null }) {
        const Mapping = this._getModel();
        const normalizedRoleKeys = [...new Set((roleKeys || []).map(resolveRoleKey).filter(Boolean))];
        const entries = [];

        if (email) {
            entries.push({
                identifier: email.toLowerCase().trim(),
                societyId,
                userId,
                roleKeys: normalizedRoleKeys,
                flatId,
            });
        }

        if (mobile) {
            entries.push({
                identifier: mobile.trim(),
                societyId,
                userId,
                roleKeys: normalizedRoleKeys,
                flatId,
            });
        }

        if (entries.length === 0) return [];

        return Mapping.insertMany(entries);
    }

    /**
     * Ensure all mappings for a user include the given roleKey (dual-role support).
     */
    async addRoleKey(societyId, userId, roleKey) {
        const normalized = resolveRoleKey(roleKey);
        if (!normalized) return null;

        const Mapping = this._getModel();
        return Mapping.updateMany(
            { societyId, userId },
            { $addToSet: { roleKeys: normalized } }
        );
    }

    /**
     * Remove a roleKey from all mappings for a user in a society.
     */
    async removeRoleKey(societyId, userId, roleKey) {
        const normalized = resolveRoleKey(roleKey);
        if (!normalized) return null;

        const Mapping = this._getModel();
        return Mapping.updateMany(
            { societyId, userId },
            { $pull: { roleKeys: normalized } }
        );
    }

    /**
     * Replace roleKeys on all mappings when the user's primary role changes.
     */
    async setPrimaryRoleKey(societyId, userId, roleKey) {
        const normalized = resolveRoleKey(roleKey);
        if (!normalized) return null;

        const Mapping = this._getModel();
        return Mapping.updateMany(
            { societyId, userId },
            { $set: { roleKeys: [normalized] } }
        );
    }

    /**
     * Sync mappings after user create/update.
     * Creates missing mappings; updates roleKeys on existing ones.
     */
    async syncUserRoleKeys(societyId, user, { replacePrimary = false } = {}) {
        if (!user?._id || !user.role) return;

        const Mapping = this._getModel();
        const normalized = resolveRoleKey(user.role);
        const existing = await Mapping.find({ societyId, userId: user._id }).lean();

        if (existing.length === 0) {
            await this.createMappings({
                societyId,
                userId: user._id,
                email: user.email,
                mobile: user.mobile,
                roleKeys: [normalized],
                flatId: user.flatId || null,
            });
            return;
        }

        const update = replacePrimary
            ? { $set: { roleKeys: [normalized] } }
            : { $addToSet: { roleKeys: normalized } };

        await Mapping.updateMany({ societyId, userId: user._id }, update);
    }
}

module.exports = new UserSocietyMappingRepository();
