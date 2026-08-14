"use strict";

const RoleRepository = require("./role.repository");
const AppError       = require("../../common/AppError");

/**
 * RoleService
 *
 * Business logic for the RBAC Roles module.
 *
 * Key responsibilities:
 *  - Self-elevation prevention: committee_admin cannot edit its own role
 *  - Hard-block enforcement: modules in hardBlockedFor are silently rejected in patches
 *  - Orphaned-key cleanup: permissions referencing deprecated modules are stripped on read
 *  - Merge catalog metadata into role docs before sending to FE
 *  - Bump permissionsVersion + write audit after every successful write
 */
class RoleService {

    /**
     * List all society-level roles with their merged permissions.
     * Excludes super_admin (platform-level, not society-editable).
     *
     * @param {string} societyId
     * @returns {Array} role objects with catalog-enriched permission maps
     */
    async listRoles(societyId) {
        const [roles, catalog] = await Promise.all([
            RoleRepository.getRolesForSociety(societyId),
            RoleRepository.getPermissionCatalog(),
        ]);

        const catalogMap = new Map(catalog.map(c => [c.moduleKey, c]));

        return roles.map(role => this._enrichRole(role, catalogMap, societyId));
    }

    /**
     * Fetch a single role with full permission map, catalog metadata, and last audit entry.
     *
     * @param {string} societyId
     * @param {string} roleKey
     * @returns {Object} enriched role
     */
    async getRole(societyId, roleKey) {
        if (roleKey === "super_admin") {
            throw new AppError("Super Admin role is not society-editable.", 403);
        }

        const [role, catalog, audit] = await Promise.all([
            RoleRepository.getRoleByKey(societyId, roleKey),
            RoleRepository.getPermissionCatalog(),
            RoleRepository.getLatestAudit(societyId, roleKey),
        ]);

        if (!role) {
            throw new AppError(`Role '${roleKey}' not found.`, 404);
        }

        const catalogMap = new Map(catalog.map(c => [c.moduleKey, c]));
        const enriched   = this._enrichRole(role, catalogMap, societyId);

        return {
            ...enriched,
            lastAudit: audit
                ? {
                    changedByName: audit.changedByName || "Unknown",
                    changedAt:     audit.changedAt,
                    action:        audit.action,
                }
                : null,
        };
    }

    /**
     * Apply a partial permissions diff to a role.
     *
     * Checks performed (in order):
     *  1. Super Admin role is never editable
     *  2. committee_admin role is hard-blocked from edits (isEditable: false)
     *  3. Modules in hardBlockedFor for this roleKey are silently ignored
     *  4. For committee_admin (if we ever allow it), ceiling check vs GLOBAL
     *
     * @param {string} societyId
     * @param {string} roleKey
     * @param {Object} permDiff     - { moduleKey: { enabled, access } }
     * @param {Object} actor        - { id, name } — the Committee Admin making the change
     * @returns {Object} updated enriched role
     */
    async patchRole(societyId, roleKey, permDiff, actor) {
        // 1. Super Admin guard
        if (roleKey === "super_admin") {
            throw new AppError("Super Admin role cannot be modified.", 403);
        }

        // 2. Fetch the role to check isEditable
        const existing = await RoleRepository.getRoleByKey(societyId, roleKey);
        if (!existing) {
            throw new AppError(`Role '${roleKey}' not found.`, 404);
        }

        if (!existing.isEditable) {
            throw new AppError(
                `Role '${roleKey}' is not editable by society administrators.`,
                403,
                "ROLE_NOT_EDITABLE"
            );
        }

        // 3. Load catalog to resolve hardBlockedFor
        const catalog    = await RoleRepository.getPermissionCatalog();
        const catalogMap = new Map(catalog.map(c => [c.moduleKey, c]));

        // 4. Filter out hard-blocked modules and deprecated modules from the diff
        const safeDiff = {};
        for (const [moduleKey, patch] of Object.entries(permDiff)) {
            const catalogEntry = catalogMap.get(moduleKey);
            if (!catalogEntry) continue; // Deprecated/unknown module — skip silently

            const hardBlocked = catalogEntry.hardBlockedFor || [];
            if (hardBlocked.includes(roleKey)) continue; // Hard-blocked — skip silently

            // Validate access level is in the valid set for this module
            if (patch.access !== undefined &&
                !catalogEntry.validAccessLevels.includes(patch.access)) {
                throw new AppError(
                    `Access level '${patch.access}' is not valid for module '${moduleKey}'. ` +
                    `Valid levels: ${catalogEntry.validAccessLevels.join(", ")}`,
                    400,
                    "INVALID_ACCESS_LEVEL"
                );
            }

            safeDiff[moduleKey] = patch;
        }

        if (Object.keys(safeDiff).length === 0) {
            throw new AppError("No valid permission changes to apply.", 400, "EMPTY_DIFF");
        }

        // 5. Apply the diff (copy-on-write handled in repository)
        const updated = await RoleRepository.upsertRolePermissions(
            societyId,
            roleKey,
            safeDiff,
            actor.id,
            actor.name
        );

        // 6. Bump permissionsVersion so logged-in users' caches get invalidated
        await RoleRepository.bumpPermissionsVersion(societyId);

        return this._enrichRole(updated, catalogMap, societyId);
    }

    /**
     * Reset a role to the GLOBAL template by deleting the society-specific override.
     *
     * @param {string} societyId
     * @param {string} roleKey
     * @param {Object} actor - { id, name }
     * @returns {Object} the GLOBAL role doc (now in effect)
     */
    async resetRole(societyId, roleKey, actor) {
        if (roleKey === "super_admin") {
            throw new AppError("Super Admin role cannot be modified.", 403);
        }

        const existing = await RoleRepository.getRoleByKey(societyId, roleKey);
        if (!existing) {
            throw new AppError(`Role '${roleKey}' not found.`, 404);
        }

        if (!existing.isEditable) {
            throw new AppError(
                `Role '${roleKey}' is not editable by society administrators.`,
                403,
                "ROLE_NOT_EDITABLE"
            );
        }

        await RoleRepository.deleteSocietyOverride(
            societyId,
            roleKey,
            actor.id,
            actor.name
        );

        // Bump permissionsVersion
        await RoleRepository.bumpPermissionsVersion(societyId);

        // Return the now-active GLOBAL role
        return this.getRole(societyId, roleKey);
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    /**
     * Merge catalog metadata into a role doc's permissions map.
     *
     * For each module in the catalog:
     *  - Modules in hardBlockedFor for this role are OMITTED entirely (not shown as toggles)
     *  - Modules not in the role's permissions map default to { enabled: false, access: "none" }
     *  - Orphaned keys in the role's permissions (not in catalog) are stripped
     *
     * @param {Object} role       - raw role doc
     * @param {Map}    catalogMap - moduleKey → catalog entry
     * @param {string} societyId
     * @returns {Object} enriched role
     */
    _enrichRole(role, catalogMap, societyId) {
        const roleKey      = role.roleKey;
        const rawPerms     = role.permissions || {};
        // Map might be a plain object or a Map instance (depending on lean() vs doc)
        const permsObj     = rawPerms instanceof Map
            ? Object.fromEntries(rawPerms)
            : rawPerms;

        const enrichedPermissions = [];

        for (const [moduleKey, catalogEntry] of catalogMap) {
            // Hard-blocked: omit entirely — don't even render a disabled toggle
            const hardBlocked = catalogEntry.hardBlockedFor || [];
            if (hardBlocked.includes(roleKey)) continue;

            const roleEntry = permsObj[moduleKey] || { access: "none", enabled: false };

            enrichedPermissions.push({
                moduleKey,
                moduleName:       catalogEntry.moduleName,
                sortOrder:        catalogEntry.sortOrder,
                description:      catalogEntry.description,
                validAccessLevels: catalogEntry.validAccessLevels,
                enabled:          roleEntry.enabled ?? false,
                access:           roleEntry.access  ?? "none",
            });
        }

        // Sort by sortOrder for consistent UI rendering
        enrichedPermissions.sort((a, b) => a.sortOrder - b.sortOrder);

        return {
            _id:          role._id,
            societyId:    role.societyId,
            roleKey:      role.roleKey,
            roleName:     role.roleName,
            isSystemRole: role.isSystemRole,
            isEditable:   role.isEditable,
            isOverride:   role._isOverride ?? (role.societyId !== "GLOBAL"),
            updatedAt:    role.updatedAt,
            updatedBy:    role.updatedBy,
            permissions:  enrichedPermissions,
        };
    }
}

module.exports = new RoleService();
