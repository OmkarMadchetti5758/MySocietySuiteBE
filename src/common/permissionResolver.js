"use strict";

const RoleRepository = require("../modules/role/role.repository");
const {
    getRolePermissions,
    ROLE_ALIAS_MAP,
    MODULES,
    PERMISSION_LEVELS,
    PERMISSION_SCOPE,
    ROLES,
} = require("./constants");

/** Maps DB catalog moduleKey → runtime MODULES constant */
const MODULE_KEY_TO_MODULE = Object.freeze({
    societyFlatSetup:             MODULES.SOCIETY_FLAT_SETUP,
    billingAccounts:              MODULES.BILLING_ACCOUNTS,
    visitorManagement:            MODULES.VISITOR_MANAGEMENT,
    complaintsHelpdesk:           MODULES.COMPLAINTS_HELPDESK,
    noticeBoardPolls:             MODULES.NOTICE_BOARD_POLLS,
    amenityBooking:               MODULES.AMENITY_BOOKING,
    parkingManagement:            MODULES.PARKING_MANAGEMENT,
    vendorManagement:             MODULES.VENDOR_MANAGEMENT,
    staffManagement:              MODULES.STAFF_MANAGEMENT,
    documentsManager:             MODULES.DOCUMENTS_MANAGER,
    reportsDashboard:             MODULES.REPORTS_DASHBOARD,
    aiAssistant:                  MODULES.AI_ASSISTANT,
    festivalCollectionManagement: MODULES.FESTIVAL_COLLECTION,
});

/**
 * Maps user.role / legacy values → Role collection roleKey.
 * User documents store `admin`; GLOBAL role templates use the same key after seed alignment.
 */
const USER_ROLE_TO_ROLE_KEY = Object.freeze({
    [ROLES.ADMIN]:            "admin",
    committee_admin:          "admin",
    [ROLES.COMMITTEE_MEMBER]: "admin",
});

/** Higher rank = broader data visibility when permission levels tie */
const SCOPE_RANK = Object.freeze({
    [PERMISSION_SCOPE.PLATFORM]:   7,
    [PERMISSION_SCOPE.ALL]:        6,
    [PERMISSION_SCOPE.SOCIETY]:    5,
    [PERMISSION_SCOPE.FINANCIAL]:  4,
    [PERMISSION_SCOPE.FACILITY]:   4,
    [PERMISSION_SCOPE.OWN]:        3,
    [PERMISSION_SCOPE.RESTRICTED]: 2,
    [PERMISSION_SCOPE.ASSIGNED]:   2,
    [PERMISSION_SCOPE.NONE]:       0,
    null:                          0,
});

/** Maps DB access vocabulary → numeric permission level */
const ACCESS_TO_LEVEL = Object.freeze({
    none:               PERMISSION_LEVELS.NO_ACCESS,
    view:               PERMISSION_LEVELS.VIEW,
    vote:               PERMISSION_LEVELS.VIEW,
    view_restricted:    PERMISSION_LEVELS.VIEW,
    view_own_profile:   PERMISSION_LEVELS.VIEW,
    financial_queries:  PERMISSION_LEVELS.VIEW,
    facility_queries:   PERMISSION_LEVELS.VIEW,
    view_pay_own:       PERMISSION_LEVELS.MANAGE,
    approve_own:        PERMISSION_LEVELS.MANAGE,
    raise_own:          PERMISSION_LEVELS.MANAGE,
    book_own:           PERMISSION_LEVELS.MANAGE,
    pay_own:            PERMISSION_LEVELS.MANAGE,
    manage:             PERMISSION_LEVELS.MANAGE,
    manage_assigned:    PERMISSION_LEVELS.MANAGE,
    financial:          PERMISSION_LEVELS.FULL,
    full:               PERMISSION_LEVELS.FULL,
});

function resolveRoleKey(role) {
    if (!role) return role;
    if (USER_ROLE_TO_ROLE_KEY[role]) {
        return USER_ROLE_TO_ROLE_KEY[role];
    }
    const aliased = ROLE_ALIAS_MAP[role] || role;
    return USER_ROLE_TO_ROLE_KEY[aliased] || aliased;
}

function normalizeRoleKeys(roleKeys, fallbackRole) {
    const keys = (Array.isArray(roleKeys) ? roleKeys : [])
        .filter(Boolean)
        .map(resolveRoleKey);

    if (keys.length === 0 && fallbackRole) {
        keys.push(resolveRoleKey(fallbackRole));
    }

    return [...new Set(keys)];
}

function normalizePermissionsMap(rawPermissions) {
    if (!rawPermissions) return {};
    if (rawPermissions instanceof Map) {
        return Object.fromEntries(rawPermissions);
    }
    return rawPermissions;
}

function scopeRank(scope) {
    return SCOPE_RANK[scope] ?? 0;
}

/**
 * Union permission matrices — highest level wins; on tie, broader scope wins.
 */
function mergePermissionMatrices(matrices) {
    const merged = {};

    for (const matrix of matrices) {
        if (!matrix) continue;

        for (const [moduleName, perm] of Object.entries(matrix)) {
            const existing = merged[moduleName];

            if (
                !existing
                || perm.level > existing.level
                || (
                    perm.level === existing.level
                    && scopeRank(perm.scope) > scopeRank(existing.scope)
                )
            ) {
                merged[moduleName] = { ...perm };
            }
        }
    }

    return merged;
}

/**
 * Resolve permissions for a single roleKey, overlaying society DB overrides when present.
 */
async function resolvePermissionsForRoleKey(societyId, roleKey) {
    const normalizedKey = resolveRoleKey(roleKey);
    const base = getRolePermissions(normalizedKey) || getRolePermissions(roleKey);

    if (!base) {
        return null;
    }

    if (!societyId || normalizedKey === ROLES.SUPER_ADMIN) {
        return { ...base };
    }

    let dbRole;

    try {
        dbRole = await RoleRepository.getRoleByKey(String(societyId), normalizedKey);
    } catch (_) {
        return { ...base };
    }

    if (!dbRole) {
        return { ...base };
    }

    const effective = { ...base };
    const dbPermissions = normalizePermissionsMap(dbRole.permissions);

    for (const [moduleKey, entry] of Object.entries(dbPermissions)) {
        const moduleName = MODULE_KEY_TO_MODULE[moduleKey];
        if (!moduleName) continue;

        if (!entry?.enabled) {
            effective[moduleName] = {
                level: PERMISSION_LEVELS.NO_ACCESS,
                scope: PERMISSION_SCOPE.NONE,
            };
            continue;
        }

        const level = ACCESS_TO_LEVEL[entry.access];
        if (level === undefined) continue;

        effective[moduleName] = {
            ...(effective[moduleName] || { scope: PERMISSION_SCOPE.NONE }),
            level,
        };
    }

    return effective;
}

/**
 * Resolve effective permissions for a user holding one or more roleKeys in a society.
 */
async function resolveEffectivePermissionsForRoles(societyId, roleKeys, fallbackRole) {
    const keys = normalizeRoleKeys(roleKeys, fallbackRole);

    if (keys.length === 0) {
        return null;
    }

    const matrices = await Promise.all(
        keys.map((roleKey) => resolvePermissionsForRoleKey(societyId, roleKey))
    );

    const valid = matrices.filter(Boolean);
    if (valid.length === 0) {
        return null;
    }

    return mergePermissionMatrices(valid);
}

/**
 * Backward-compatible single-role resolver.
 */
async function resolveEffectivePermissions(societyId, role) {
    return resolveEffectivePermissionsForRoles(societyId, null, role);
}

/**
 * Returns true if the user's roleKeys (or primary role) match any allowed role.
 */
function userHasAnyRole(user, allowedRoles) {
    if (!user?.role) return false;

    const keys = new Set([
        resolveRoleKey(user.role),
        ...(user.roleKeys || []).map(resolveRoleKey),
    ]);

    return allowedRoles.some((role) => keys.has(resolveRoleKey(role)));
}

module.exports = {
    MODULE_KEY_TO_MODULE,
    ACCESS_TO_LEVEL,
    SCOPE_RANK,
    resolveRoleKey,
    normalizeRoleKeys,
    mergePermissionMatrices,
    resolvePermissionsForRoleKey,
    resolveEffectivePermissionsForRoles,
    resolveEffectivePermissions,
    userHasAnyRole,
};
