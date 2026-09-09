"use strict";

const { getMasterConnection } = require("../../config/masterDb");
const { resolveRoleKey } = require("../../common/permissionResolver");
const { canonicalIdentifier } = require("../../common/loginIdentifier");
const AppError = require("../../common/AppError");

/**
 * UserSocietyMappingRepository
 *
 * Login lookup is identifier → society. A user with both email and mobile
 * MUST have two mapping rows so they can sign in with either.
 */
class UserSocietyMappingRepository {
    _getModel() {
        return getMasterConnection().model("UserSocietyMapping");
    }

    normalizeIdentifier(value) {
        return canonicalIdentifier(value);
    }

    /**
     * Unique, normalised identifiers for a user (email and/or mobile).
     */
    collectIdentifiers(email, mobile) {
        const identifiers = [];
        const seen = new Set();

        for (const value of [email, mobile]) {
            const id = this.normalizeIdentifier(value);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            identifiers.push(id);
        }

        return identifiers;
    }

    /**
     * Create identifier mappings for a user (email and/or mobile).
     */
    async createMappings({ societyId, userId, email, mobile, roleKeys, flatId = null, status = "active" }) {
        const Mapping = this._getModel();
        const normalizedRoleKeys = [...new Set((roleKeys || []).map(resolveRoleKey).filter(Boolean))];
        const identifiers = this.collectIdentifiers(email, mobile);

        const entries = identifiers.map((identifier) => ({
            identifier,
            societyId,
            userId,
            roleKeys: normalizedRoleKeys,
            flatId,
            status,
        }));

        if (entries.length === 0) return [];

        try {
            return await Mapping.insertMany(entries, { ordered: false });
        } catch (err) {
            const isDup = err.code === 11000 || err.writeErrors?.some((e) => e.code === 11000);
            if (!isDup) throw err;

            const existing = await Mapping.find({
                societyId,
                userId,
                identifier: { $in: identifiers },
            }).lean();
            const have = new Set(existing.map((row) => row.identifier));
            if (identifiers.every((id) => have.has(id))) {
                return existing;
            }

            throw new AppError(
                "This email or phone number is already registered in this society.",
                409,
                "IDENTIFIER_TAKEN"
            );
        }
    }

    /**
     * Ensure every identifier on the user has a mapping row.
     * Used on create, update, and as a login-time repair for older records.
     */
    async ensureIdentifierMappings(societyId, user, extras = {}) {
        if (!user?._id) return [];

        const Mapping = this._getModel();
        const identifiers = this.collectIdentifiers(user.email, user.mobile);
        if (identifiers.length === 0) return [];

        const existing = await Mapping.find({ societyId, userId: user._id }).lean();
        const existingIds = new Set(existing.map((row) => row.identifier));

        const template = existing[0] || {};
        const roleKeys = extras.roleKeys
            || template.roleKeys
            || (user.role ? [resolveRoleKey(user.role)] : []);
        const flatId = extras.flatId !== undefined ? extras.flatId : (template.flatId || null);
        const status = extras.status || template.status || "active";

        const missing = identifiers.filter((id) => !existingIds.has(id));
        if (missing.length === 0) return existing;

        try {
            await Mapping.insertMany(
                missing.map((identifier) => ({
                    identifier,
                    societyId,
                    userId: user._id,
                    roleKeys,
                    flatId,
                    status,
                })),
                { ordered: false }
            );
        } catch (err) {
            // Duplicate key: another request created the same identifier concurrently
            if (err.code !== 11000) throw err;
        }

        return Mapping.find({ societyId, userId: user._id }).lean();
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
     * Creates missing identifier rows; updates roleKeys on existing ones.
     */
    async syncUserRoleKeys(societyId, user, { replacePrimary = false } = {}) {
        if (!user?._id || !user.role) return;

        const Mapping = this._getModel();
        const normalized = resolveRoleKey(user.role);

        await this.ensureIdentifierMappings(societyId, user, {
            roleKeys: [normalized],
        });

        const update = replacePrimary
            ? { $set: { roleKeys: [normalized] } }
            : { $addToSet: { roleKeys: normalized } };

        await Mapping.updateMany({ societyId, userId: user._id }, update);
    }
}

module.exports = new UserSocietyMappingRepository();
