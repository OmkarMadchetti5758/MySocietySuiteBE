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
        userName: {
            type: String,
        },
        userRole: {
            type: String,
            required: true,
        },
        action: {
            type: String,
            required: true,
            index: true,
        },
        module: {
            type: String,
            default: "Accounting",
        },
        transactionType: {
            type: String,
            index: true,
        },
        entityType: {
            type: String,
        },
        entityId: {
            type: mongoose.Schema.Types.ObjectId,
        },
        transactionId: {
            type: String,
        },
        orderId: {
            type: String,
        },
        referenceId: {
            type: String,
        },
        description: {
            type: String,
        },
        beforeValue: {
            type: mongoose.Schema.Types.Mixed,
        },
        afterValue: {
            type: mongoose.Schema.Types.Mixed,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        timestamp: {
            type: Date,
            default: Date.now,
            index: true,
        },
        // Legacy fields for backward compatibility
        resource: { type: String },
        resourceId: { type: String },
        status: { type: String },
        amount: { type: Number },
        details: { type: mongoose.Schema.Types.Mixed },
        ipAddress: { type: String },
    },
    { timestamps: true }
);

billingAuditLogSchema.index({ societyId: 1, timestamp: -1 });
billingAuditLogSchema.index({ societyId: 1, userId: 1, timestamp: -1 });
billingAuditLogSchema.index({ societyId: 1, transactionType: 1, timestamp: -1 });

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
async function logBillingAction(params) {
    try {
        const {
            req, db,
            action, module = "Billing", transactionType, entityType, entityId,
            transactionId, orderId, referenceId, description,
            beforeValue, afterValue, metadata = {},
            // Legacy params
            resource, resourceId, status = "SUCCESS", amount = null, details = {}
        } = params;

        const auditDb = db || req?.opsDb;
        if (!auditDb) return;

        const AuditModel = getBillingAuditModel(auditDb);
        const user = req?.user;

        await AuditModel.create({
            societyId: user?.societyId || details?.societyId || params.societyId,
            userId: user?.id || params.userId,
            userName: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : params.userName,
            userRole: user?.role || (user?.roleKeys ? user.roleKeys[0] : "unknown") || params.userRole,
            
            action,
            module: module || "Billing",
            transactionType: transactionType || resource,
            entityType: entityType || resource,
            entityId: entityId || (resourceId && mongoose.Types.ObjectId.isValid(resourceId) ? resourceId : null),
            transactionId,
            orderId,
            referenceId,
            description,
            beforeValue,
            afterValue,
            metadata: Object.keys(metadata).length ? metadata : details,
            timestamp: new Date(),

            // Legacy fields mapped just in case
            resource,
            resourceId: resourceId ? String(resourceId) : null,
            status,
            amount,
            details,
            ipAddress: req?.ip || req?.headers?.["x-forwarded-for"],
        });
    } catch (err) {
        console.error("[BILLING AUDIT ERROR] Failed to record audit log:", err.message);
    }
}

module.exports = {
    getBillingAuditModel,
    logBillingAction,
};
