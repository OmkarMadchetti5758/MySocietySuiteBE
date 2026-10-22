"use strict";

const RoleRepository = require("./role.repository");
const AppError = require("../../common/AppError");

class RoleService {

    async listRoles(societyId) {
        const [roles, catalog, plan] = await Promise.all([
            RoleRepository.getRolesForSociety(societyId),
            RoleRepository.getPermissionCatalog(),
            RoleRepository.getSocietyPlan(societyId),
        ]);

        const allowedModules = plan?.modules ? new Set(plan.modules) : null;
        const filteredCatalog = allowedModules
            ? catalog.filter(c => allowedModules.has(c.moduleKey))
            : catalog;
        const catalogMap = new Map(filteredCatalog.map(c => [c.moduleKey, c]));

        return roles.map(role => this._enrichRole(role, catalogMap, societyId, plan));
    }

    async getRole(societyId, roleKey) {
        if (roleKey === "super_admin") {
            throw new AppError("Super Admin role is not society-editable.", 403);
        }

        const [role, catalog, audit, plan] = await Promise.all([
            RoleRepository.getRoleByKey(societyId, roleKey),
            RoleRepository.getPermissionCatalog(),
            RoleRepository.getLatestAudit(societyId, roleKey),
            RoleRepository.getSocietyPlan(societyId),
        ]);

        if (!role) {
            throw new AppError(`Role '${roleKey}' not found.`, 404);
        }

        const allowedModules = plan?.modules ? new Set(plan.modules) : null;
        const filteredCatalog = allowedModules
            ? catalog.filter(c => allowedModules.has(c.moduleKey))
            : catalog;
        const catalogMap = new Map(filteredCatalog.map(c => [c.moduleKey, c]));
        const enriched = this._enrichRole(role, catalogMap, societyId, plan);

        return {
            ...enriched,
            lastAudit: audit
                ? {
                    changedByName: audit.changedByName || "Unknown",
                    changedAt: audit.changedAt,
                    action: audit.action,
                }
                : null,
        };
    }

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

        // 3. Load catalog and active plan
        const [catalog, plan] = await Promise.all([
            RoleRepository.getPermissionCatalog(),
            RoleRepository.getSocietyPlan(societyId),
        ]);
        const allowedModules = plan?.modules ? new Set(plan.modules) : null;
        const filteredCatalog = allowedModules
            ? catalog.filter(c => allowedModules.has(c.moduleKey))
            : catalog;
        const catalogMap = new Map(filteredCatalog.map(c => [c.moduleKey, c]));

        // 4. Filter out hard-blocked modules, non-plan modules, and deprecated modules
        const safeDiff = {};
        for (const [moduleKey, patch] of Object.entries(permDiff)) {
            const catalogEntry = catalogMap.get(moduleKey);
            if (!catalogEntry) continue; // Deprecated/unknown module - skip silently

            // Plan restriction check
            if (allowedModules && !allowedModules.has(moduleKey)) {
                throw new AppError(
                    `Module '${moduleKey}' is not included in the active subscription plan (${plan?.name || "current"}).`,
                    403,
                    "PLAN_RESTRICTION"
                );
            }

            const hardBlocked = catalogEntry.hardBlockedFor || [];
            if (hardBlocked.includes(roleKey)) continue; // Hard-blocked - skip silently

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

        return this._enrichRole(updated, catalogMap, societyId, plan);
    }

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

    _enrichRole(role, catalogMap, societyId, plan = null) {
        const roleKey = role.roleKey;
        const rawPerms = role.permissions || {};
        // Map might be a plain object or a Map instance (depending on lean() vs doc)
        const permsObj = rawPerms instanceof Map
            ? Object.fromEntries(rawPerms)
            : rawPerms;

        const enrichedPermissions = [];

        for (const [moduleKey, catalogEntry] of catalogMap) {
            // Hard-blocked: omit entirely - don't even render a disabled toggle
            const hardBlocked = catalogEntry.hardBlockedFor || [];
            if (hardBlocked.includes(roleKey)) continue;

            const roleEntry = permsObj[moduleKey] || { access: "none", enabled: false };

            enrichedPermissions.push({
                moduleKey,
                moduleName: catalogEntry.moduleName,
                sortOrder: catalogEntry.sortOrder,
                description: catalogEntry.description,
                validAccessLevels: catalogEntry.validAccessLevels,
                enabled: roleEntry.enabled ?? false,
                access: roleEntry.access ?? "none",
            });
        }

        // Sort by sortOrder for consistent UI rendering
        enrichedPermissions.sort((a, b) => a.sortOrder - b.sortOrder);

        return {
            _id: role._id,
            societyId: role.societyId,
            roleKey: role.roleKey,
            roleName: role.roleName,
            isSystemRole: role.isSystemRole,
            isEditable: role.isEditable,
            isOverride: role._isOverride ?? (role.societyId !== "GLOBAL"),
            updatedAt: role.updatedAt,
            updatedBy: role.updatedBy,
            permissions: enrichedPermissions,
            activePlan: plan ? {
                name: plan.name,
                slug: plan.slug,
                tagline: plan.tagline,
                modules: plan.modules,
                features: plan.features
            } : null
        };
    }
}

module.exports = new RoleService();
