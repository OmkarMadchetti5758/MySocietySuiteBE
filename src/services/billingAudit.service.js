"use strict";

const mongoose = require("mongoose");

const billingAuditLogSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: true,
            index: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        userRole: {
            type: String,
            required: true,
        },
        action: {
            type: String,
            required: true,
            index: true,
            // e.g. "BILLING.CREDIT_NOTE.CREATE", "BILLING.CREDIT_NOTE.APPROVE"
        },
        resource: {
            type: String,
            required: true,
            // e.g. "CreditNote", "Invoice", "ChargeHead"
        },
        resourceId: {
            type: String,
            default: null,
        },
        status: {
            type: String,
            enum: ["SUCCESS", "DENIED", "FAILED"],
            default: "SUCCESS",
        },
        amount: {
            type: Number,
            default: null,
        },
        details: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        ipAddress: {
            type: String,
            default: null,
        },
    },
    { timestamps: true }
);

billingAuditLogSchema.index({ societyId: 1, createdAt: -1 });

function getBillingAuditModel(db) {
    if (!db) {
        const { getOperationsConnection } = require("../config/operationsDb");
        db = getOperationsConnection();
    }
    return db.models.BillingAuditLog || db.model("BillingAuditLog", billingAuditLogSchema);
}

/**
 * Audit Logger for Accounting & Billing Actions
 */
async function logBillingAction({ req, db, action, resource, resourceId, status = "SUCCESS", amount = null, details = {} }) {
    try {
        const auditDb = db || req?.opsDb;
        if (!auditDb) return;

        const AuditModel = getBillingAuditModel(auditDb);

        await AuditModel.create({
            societyId:  req?.user?.societyId || details?.societyId,
            userId:     req?.user?.id,
            userRole:   req?.user?.role || (req?.user?.roleKeys ? req.user.roleKeys[0] : "unknown"),
            action,
            resource,
            resourceId: resourceId ? String(resourceId) : null,
            status,
            amount,
            details,
            ipAddress:  req?.ip || req?.headers?.["x-forwarded-for"],
        });
    } catch (err) {
        console.error("[BILLING AUDIT ERROR] Failed to record audit log:", err.message);
    }
}

module.exports = {
    getBillingAuditModel,
    logBillingAction,
};
