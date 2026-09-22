"use strict";

const { logBillingAction } = require("../services/billingAudit.service");

/**
 * Utility wrapper for creating audit logs across financial modules
 */
const createAuditLog = async ({ societyId, userId, action, entityType, entityId, newValue, req }) => {
    try {
        await logBillingAction({
            req: req || { user: { societyId, id: userId, role: "user" } },
            action: `RECONCILIATION.${action}`,
            resource: entityType,
            resourceId: entityId,
            status: "SUCCESS",
            details: { societyId, userId, newValue }
        });
    } catch (err) {
        console.error("[AUDIT LOG ERROR]", err.message);
    }
};

module.exports = createAuditLog;
