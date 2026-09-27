"use strict";

const { BILLING_PERMISSIONS, BILLING_ROLE_MATRIX } = require("../common/billingPermissions");
const { resolveRoleKey } = require("../common/permissionResolver");
const { ROLES } = require("../common/constants");
const RoleRepository = require("../modules/role/role.repository");

// Default approval threshold for Accountant financial actions (Credit Note, Discount, Vendor Payment)
const DEFAULT_ACCOUNTANT_APPROVAL_THRESHOLD = 5000;

function getUserRoleKeys(user) {
    if (!user) return [];
    if (Array.isArray(user.roleKeys) && user.roleKeys.length > 0) {
        return user.roleKeys.map(resolveRoleKey);
    }
    if (user.role) {
        return [resolveRoleKey(user.role)];
    }
    return [];
}

function hasBillingPermission(user, permissionKey) {
    if (!user) return false;

    const roleKeys = getUserRoleKeys(user);
    if (roleKeys.includes(ROLES.SUPER_ADMIN)) {
        return false;
    }

    for (const roleKey of roleKeys) {
        const allowedPermissions = BILLING_ROLE_MATRIX[roleKey];
        if (allowedPermissions && allowedPermissions.includes(permissionKey)) {
            return true;
        }
        // Handle admin / committee_admin legacy alias match
        if ((roleKey === "admin" || roleKey === "committee_member") && BILLING_ROLE_MATRIX[ROLES.ADMIN]?.includes(permissionKey)) {
            return true;
        }
        // Handle resident_owner / resident_tenant / resident aliases
        if ((roleKey === "resident" || roleKey === "resident_tenant") && BILLING_ROLE_MATRIX[ROLES.RESIDENT_OWNER]?.includes(permissionKey)) {
            return true;
        }
    }

    return false;
}

/**
 * Convert a BILLING_PERMISSIONS value (e.g. "BILLING.VENDOR_PAYMENT.CREATE")
 * to a namespaced Role.permissions Map key (e.g. "billing.vendorPayment.create").
 */
function _permKeyToMapKey(permissionKey) {
    // "BILLING.VENDOR_PAYMENT.CREATE" → ["BILLING", "VENDOR_PAYMENT", "CREATE"]
    const parts = permissionKey.split(".");
    if (parts.length < 3) return null;

    // Convert VENDOR_PAYMENT → vendorPayment (camelCase)
    const resource = parts[1]
        .toLowerCase()
        .replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const action = parts[2]
        .toLowerCase()
        .replace(/_([a-z])/g, (_, c) => c.toUpperCase());

    return `billing.${resource}.${action}`;
}

/**
 * Async version of hasBillingPermission.
 * Checks DB-based Role.permissions sub-keys first, then falls back to the
 * hardcoded BILLING_ROLE_MATRIX.
 *
 * DB keys are stored in the Role.permissions Map as:
 *   "billing.vendorPayment.create": { access: "full", enabled: true }
 *
 * If a DB override exists and is explicitly disabled (enabled: false),
 * the user is denied even if the matrix would allow it.
 * If no DB override exists, the hardcoded matrix is the source of truth.
 */
async function hasBillingPermissionAsync(user, permissionKey) {
    if (!user) return false;

    const roleKeys = getUserRoleKeys(user);
    if (roleKeys.includes(ROLES.SUPER_ADMIN)) {
        return false;
    }

    const mapKey = _permKeyToMapKey(permissionKey);
    const societyId = user.societyId;

    // Attempt DB-based lookup if society-scoped and we have a valid map key
    if (mapKey && societyId) {
        for (const roleKey of roleKeys) {
            try {
                const dbRole = await RoleRepository.getRoleByKey(String(societyId), roleKey);
                if (dbRole) {
                    const permsObj = dbRole.permissions instanceof Map
                        ? Object.fromEntries(dbRole.permissions)
                        : (dbRole.permissions || {});
                    const entry = permsObj[mapKey];
                    if (entry !== undefined) {
                        // Explicit DB override found
                        return entry.enabled === true;
                    }
                }
            } catch (_) {
                // DB lookup failed; fall through to matrix
            }
        }
    }

    // Fallback to hardcoded matrix (existing behavior)
    return hasBillingPermission(user, permissionKey);
}
function canAccessBillingResource(user, resource, action) {
    if (!user) return false;

    // Is it a resident own-resource permission check?
    const isOwnResourceAction = [
        BILLING_PERMISSIONS.OWN_INVOICE_VIEW,
        BILLING_PERMISSIONS.OWN_PAYMENT_CREATE,
        BILLING_PERMISSIONS.OWN_PAYMENT_VIEW,
        BILLING_PERMISSIONS.OWN_LEDGER_VIEW,
    ].includes(action);

    if (isOwnResourceAction) {
        if (!resource) return false;

        // Resource must belong to the user's flat or userId
        const matchesUser = resource.userId && String(resource.userId) === String(user.id);
        const matchesFlat = resource.flatId && user.flatId && String(resource.flatId) === String(user.flatId);

        if (!matchesUser && !matchesFlat) {
            return false;
        }
    }

    // Society scope validation
    if (resource && resource.societyId && user.societyId) {
        if (String(resource.societyId) !== String(user.societyId)) {
            return false;
        }
    }

    return true;
}

function requiresCommitteeApproval({ user, action, amount = 0, thresholdOverride = null }) {
    const roleKeys = getUserRoleKeys(user);
    const isAccountant = roleKeys.includes(ROLES.ACCOUNTANT);

    // Actions that ALWAYS require approval if performed by Accountant
    const thresholdActions = [
        BILLING_PERMISSIONS.CREDIT_NOTE_CREATE,
        BILLING_PERMISSIONS.DISCOUNT_CREATE,
        BILLING_PERMISSIONS.VENDOR_PAYMENT_CREATE,
    ];

    if (!isAccountant || !thresholdActions.includes(action)) {
        return false;
    }

    const effectiveThreshold = thresholdOverride ?? DEFAULT_ACCOUNTANT_APPROVAL_THRESHOLD;

    // If transaction amount exceeds threshold, approval is required
    return amount > effectiveThreshold;
}

function checkSelfApproval(user, resource) {
    if (!user || !resource) return false;

    const userId = user.id || user._id;
    const creatorId = resource.createdBy || resource.requestedBy;

    if (creatorId && String(creatorId) === String(userId)) {
        return true; // Is self-approval attempt
    }
    return false;
}

/**
 * Dynamically resolves the Accountant approval threshold for a society.
 * Reads from the society's BillingConfiguration in the operations DB.
 * Falls back to DEFAULT_ACCOUNTANT_APPROVAL_THRESHOLD (5000) if not configured.
 */
async function getAccountantApprovalThreshold({ db, societyId } = {}) {
    if (!societyId) {
        return DEFAULT_ACCOUNTANT_APPROVAL_THRESHOLD;
    }

    try {
        const { getBillingModels } = require("../modules/billing/billing.model");
        const { BillingConfiguration } = getBillingModels(db);
        if (BillingConfiguration) {
            const config = await BillingConfiguration.findOne({ societyId }).lean();
            if (config && typeof config.accountantApprovalThreshold === "number") {
                return config.accountantApprovalThreshold;
            }
        }
    } catch {
        // Fallback to default if DB query fails
    }

    return DEFAULT_ACCOUNTANT_APPROVAL_THRESHOLD;
}

/**
 * Async version of requiresCommitteeApproval that fetches dynamic threshold from society's BillingConfiguration.
 */
async function requiresCommitteeApprovalAsync({ db, societyId, user, action, amount = 0, thresholdOverride = null }) {
    const effectiveThreshold = thresholdOverride !== null && thresholdOverride !== undefined
        ? thresholdOverride
        : await getAccountantApprovalThreshold({ db, societyId: societyId || user?.societyId });

    return requiresCommitteeApproval({ user, action, amount, thresholdOverride: effectiveThreshold });
}

module.exports = {
    getUserRoleKeys,
    hasBillingPermission,
    hasBillingPermissionAsync,
    canAccessBillingResource,
    requiresCommitteeApproval,
    requiresCommitteeApprovalAsync,
    getAccountantApprovalThreshold,
    checkSelfApproval,
    DEFAULT_ACCOUNTANT_APPROVAL_THRESHOLD,
};
