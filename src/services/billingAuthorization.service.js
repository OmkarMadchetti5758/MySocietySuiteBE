"use strict";

const { BILLING_PERMISSIONS, BILLING_ROLE_MATRIX } = require("../common/billingPermissions");
const { resolveRoleKey } = require("../common/permissionResolver");
const { ROLES } = require("../common/constants");

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

    if (resource.createdBy && String(resource.createdBy) === String(user.id)) {
        return true; // Is self-approval attempt
    }
    return false;
}

module.exports = {
    getUserRoleKeys,
    hasBillingPermission,
    canAccessBillingResource,
    requiresCommitteeApproval,
    checkSelfApproval,
    DEFAULT_ACCOUNTANT_APPROVAL_THRESHOLD,
};
