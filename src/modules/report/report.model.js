"use strict";

const mongoose = require("mongoose");

const reportSettingsSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: true,
            unique: true,
            index: true,
        },

        // TODO(BA): Confirm accounting basis — defaulting to ACCRUAL (income at invoice date)
        accountingBasis: {
            type: String,
            enum: ["ACCRUAL", "CASH"],
            default: "ACCRUAL",
        },

        // TODO(BA): Confirm ageing bucket basis — defaulting to DUE_DATE
        // DUE_DATE = days past due date; INVOICE_DATE = days past invoice date
        ageingBasis: {
            type: String,
            enum: ["DUE_DATE", "INVOICE_DATE"],
            default: "DUE_DATE",
        },

        // TODO(BA): Confirm GST split — defaulting to intra-state CGST+SGST 50/50
        gstSplit: {
            type: String,
            enum: ["CGST_SGST", "IGST"],
            default: "CGST_SGST",
        },

        // TODO(BA): Confirm Tally version — defaulting to Tally Prime 3.x
        tallyVersion: {
            type: String,
            default: "PRIME_3X",
        },

        // Default financial year start month (1=Jan, 4=Apr). India standard = 4
        fyStartMonth: {
            type: Number,
            default: 4,
            min: 1,
            max: 12,
        },

        // Timezone for all date computations — BRD: Asia/Kolkata
        timezone: {
            type: String,
            default: "Asia/Kolkata",
        },

        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
    },
    { timestamps: true }
);

const exportJobSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: true,
            index: true,
        },
        requestedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        // Report type — maps to a service function
        reportType: {
            type: String,
            enum: [
                "BALANCE_SHEET",
                "PROFIT_LOSS",
                "GST",
                "TDS",
                "DUES_AGEING",
                "COLLECTIONS",
                "TALLY",
                "LEDGER_MASTERS",
                "INVOICES",
            ],
            required: true,
            index: true,
        },

        // Output format
        format: {
            type: String,
            enum: ["CSV", "EXCEL", "PDF", "TALLY_XML"],
            required: true,
        },

        // Date range / as-of params (stored for determinism; re-export = same output)
        params: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
        },

        // Idempotency: same (societyId, requestedBy, reportType, format, params hash)
        // → return existing job if still PENDING or DONE within 24h
        paramsHash: {
            type: String,
            required: true,
            index: true,
        },

        status: {
            type: String,
            enum: ["PENDING", "PROCESSING", "DONE", "FAILED"],
            default: "PENDING",
            index: true,
        },

        // S3 key (never public; access only via signed URL)
        s3Key: { type: String, default: null },

        // Signed URL (short-lived, generated on demand)
        // Never stored permanently — generated fresh on each GET /exports/:id/download
        downloadUrl: { type: String, default: null },
        downloadUrlExpiresAt: { type: Date, default: null },

        // File size in bytes (for UI display)
        fileSizeBytes: { type: Number, default: null },

        errorMessage: { type: String, default: null },
        startedAt: { type: Date, default: null },
        completedAt: { type: Date, default: null },

        // Retry state
        attempts: { type: Number, default: 0 },
        lastAttemptAt: { type: Date, default: null },
    },
    { timestamps: true }
);

exportJobSchema.index({ societyId: 1, reportType: 1, status: 1 });
exportJobSchema.index({ societyId: 1, requestedBy: 1, createdAt: -1 });
exportJobSchema.index({ societyId: 1, paramsHash: 1 }, { sparse: true });
// Auto-expire S3 files after 7 days (TTL on completedAt + 7d handled in worker)
exportJobSchema.index({ completedAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });

// ── Model Factory ────────────────────────────────────────────────────────────
function getReportModels(db) {
    if (!db) {
        const { getOperationsConnection } = require("../../config/operationsDb");
        db = getOperationsConnection();
    }
    return {
        ReportSettings: db.models.ReportSettings || db.model("ReportSettings", reportSettingsSchema),
        ExportJob: db.models.ExportJob || db.model("ExportJob", exportJobSchema),
    };
}

module.exports = {
    getReportModels,
    reportSettingsSchema,
    exportJobSchema,
};
