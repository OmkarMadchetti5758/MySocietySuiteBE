"use strict";

const { getMasterConnection }     = require("../../config/masterDb");
const { getOperationsConnection } = require("../../config/operationsDb");
const { bustPermissionsVersionCache } = require("../../common/permissionsVersionCache");

/**
 * RoleRepository
 *
 * All DB access for the Roles & Permissions module.
 *
 * GLOBAL fallback pattern:
 *   When a society-specific role doc doesn't exist, we transparently serve the
 *   GLOBAL doc instead. This is the "read-through" that prevents 404s on first
 *   load and avoids eager-cloning GLOBAL docs into every new society.
 *
 * Copy-on-write:
 *   The first time a society admin saves a change, we create the society-specific
 *   override doc. Subsequent saves update that doc. The repo handles this via upsert.
 */
class RoleRepository {
    _masterDb() { return getMasterConnection(); }
    _opsDb()    { return getOperationsConnection(); }

    // ── Permission Catalog ─────────────────────────────────────────────────────

    /**
     * Fetch all non-deprecated permission catalog entries, sorted by sortOrder.
     */
    async getPermissionCatalog() {
        const Permission = this._masterDb().model("Permission");
        return Permission.find({ isDeprecated: { $ne: true } })
            .sort({ sortOrder: 1 })
            .lean();
    }

    // ── Roles ──────────────────────────────────────────────────────────────────

    /**
     * Fetch all society-level roles (excludes super_admin).
     *
     * For each roleKey, returns the society-specific doc if it exists,
     * otherwise falls back to the GLOBAL doc.
     *
     * @param {string} societyId - ObjectId string
     * @returns {Array} merged role docs
     */
    async getRolesForSociety(societyId) {
        const Role = this._masterDb().model("Role");

        // Fetch both society-specific overrides and GLOBAL docs in one query
        const all = await Role.find({
            societyId: { $in: [societyId, "GLOBAL"] },
            roleKey:   { $ne: "super_admin" },          // Super Admin is never shown
        }).lean();

        // Group by roleKey — society-specific wins over GLOBAL
        const map = new Map();
        for (const doc of all) {
            const key = doc.roleKey;
            if (!map.has(key)) {
                map.set(key, doc);
            } else {
                // If we already have a doc for this key, prefer the society-specific one
                const existing = map.get(key);
                if (doc.societyId !== "GLOBAL") {
                    map.set(key, doc); // society-specific overrides GLOBAL
                } else if (existing.societyId === "GLOBAL") {
                    // keep existing (both are GLOBAL, shouldn't happen but guard)
                }
            }
        }

        return Array.from(map.values());
    }

    /**
     * Fetch a single role for a society, falling back to GLOBAL if no override exists.
     *
     * @param {string} societyId
     * @param {string} roleKey
     * @returns {Object|null} role doc (lean) or null if not found even in GLOBAL
     */
    async getRoleByKey(societyId, roleKey) {
        const Role = this._masterDb().model("Role");

        // Try society-specific first
        let doc = await Role.findOne({ societyId, roleKey }).lean();
        if (doc) return { ...doc, _isOverride: true };

        // Fall back to GLOBAL
        doc = await Role.findOne({ societyId: "GLOBAL", roleKey }).lean();
        if (doc) return { ...doc, _isOverride: false };

        return null;
    }

    /**
     * Fetch the GLOBAL template for a role (used for self-elevation ceiling check).
     */
    async getGlobalRole(roleKey) {
        const Role = this._masterDb().model("Role");
        return Role.findOne({ societyId: "GLOBAL", roleKey }).lean();
    }

    /**
     * Apply a partial permissions diff to a role (copy-on-write).
     *
     * If no society-specific doc exists, creates one by copying the GLOBAL template
     * then applying the diff.
     *
     * @param {string} societyId
     * @param {string} roleKey
     * @param {Object} permDiff - map of { moduleKey: { enabled, access } }
     * @param {Object} actorId  - userId of the admin making the change
     * @param {string} actorName
     * @returns {Object} updated role doc
     */
    async upsertRolePermissions(societyId, roleKey, permDiff, actorId, actorName) {
        const Role = this._masterDb().model("Role");

        // Find or seed the society-specific doc
        let doc = await Role.findOne({ societyId, roleKey });

        if (!doc) {
            // Copy-on-write: clone the GLOBAL template
            const globalDoc = await Role.findOne({ societyId: "GLOBAL", roleKey }).lean();
            if (!globalDoc) {
                throw new Error(`No GLOBAL template found for role: ${roleKey}`);
            }

            // Create a new society-specific doc from GLOBAL
            doc = new Role({
                societyId,
                roleKey:      globalDoc.roleKey,
                roleName:     globalDoc.roleName,
                isSystemRole: globalDoc.isSystemRole,
                isEditable:   globalDoc.isEditable,
                permissions:  new Map(Object.entries(globalDoc.permissions || {})),
                updatedAt:    new Date(),
                updatedBy:    actorId,
            });
        }

        // Snapshot before-state for audit
        const before = Object.fromEntries(doc.permissions || new Map());

        // Apply diff — only update moduleKeys present in the diff
        for (const [moduleKey, patch] of Object.entries(permDiff)) {
            const existing = doc.permissions.get(moduleKey) || {};
            doc.permissions.set(moduleKey, {
                access:  patch.access  !== undefined ? patch.access  : existing.access,
                enabled: patch.enabled !== undefined ? patch.enabled : existing.enabled,
            });
        }

        doc.updatedAt = new Date();
        doc.updatedBy = actorId;
        doc.markModified("permissions"); // Mongoose requires this for Map fields

        await doc.save();

        // Snapshot after-state for audit
        const after = Object.fromEntries(doc.permissions);

        // Write audit log
        await this._writeAudit({
            societyId,
            roleKey,
            changedBy:   actorId,
            changedByName: actorName,
            before,
            after,
            action: "update",
        });

        return doc.toObject();
    }

    /**
     * Delete the society-specific override doc, reverting to GLOBAL.
     *
     * @param {string} societyId
     * @param {string} roleKey
     * @param {Object} actorId
     * @param {string} actorName
     */
    async deleteSocietyOverride(societyId, roleKey, actorId, actorName) {
        const Role = this._masterDb().model("Role");

        const doc = await Role.findOne({ societyId, roleKey }).lean();
        if (!doc) return null; // Nothing to reset — already at GLOBAL

        const before = doc.permissions || {};

        await Role.deleteOne({ societyId, roleKey });

        // Fetch GLOBAL to capture "after" state for audit
        const globalDoc = await Role.findOne({ societyId: "GLOBAL", roleKey }).lean();
        const after = globalDoc ? (globalDoc.permissions || {}) : {};

        await this._writeAudit({
            societyId,
            roleKey,
            changedBy:   actorId,
            changedByName: actorName,
            before,
            after,
            action: "reset",
        });

        return true;
    }

    /**
     * Bump the permissionsVersion counter on the Society doc.
     * Called after every successful role write.
     */
    async bumpPermissionsVersion(societyId) {
        const masterDb = this._masterDb();
        const Society  = masterDb.model("Society");
        await Society.updateOne(
            { _id: societyId },
            { $inc: { permissionsVersion: 1 } }
        );
        bustPermissionsVersionCache(societyId);
    }

    /**
     * Fetch the latest audit entry for a role (for "last changed by X on Y" UI).
     */
    async getLatestAudit(societyId, roleKey) {
        const opsDb = this._opsDb();
        const Audit = opsDb.model("RolePermissionAudit");
        return Audit.findOne({ societyId, roleKey })
            .sort({ changedAt: -1 })
            .lean();
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    async _writeAudit({ societyId, roleKey, changedBy, changedByName, before, after, action }) {
        const Audit = this._opsDb().model("RolePermissionAudit");
        await Audit.create({
            societyId,
            roleKey,
            changedBy,
            changedByName,
            changedAt: new Date(),
            diff: { before, after },
            action,
        });
    }
}

module.exports = new RoleRepository();
