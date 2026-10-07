"use strict";

/**
 * Budget Module – Mongoose Models
 * FR-B10.1 / FR-B10.2 / FR-B10.3 / BRD 6.12
 *
 * Money convention: ALL monetary amounts are stored as INTEGER PAISE (₹ × 100).
 * Never use floats. Display using formatINR() from report/money.js.
 *
 * Status machine (server-enforced):
 *   DRAFT  ──saveDraft──▶  DRAFT
 *   DRAFT  ──submit──────▶ PENDING_APPROVAL
 *   PENDING_APPROVAL ──approve────▶ APPROVED  (Committee Admin)
 *   PENDING_APPROVAL ──sendBack───▶ DRAFT      (Committee Admin)
 *   PENDING_APPROVAL ──withdraw───▶ DRAFT      (Accountant)
 *   APPROVED is immutable (locked).
 */

const mongoose = require("mongoose");

// ── 1. Budget (header) ───────────────────────────────────────────────────────
const budgetSchema = new mongoose.Schema(
    {
        societyId:      { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        financialYear:  { type: String, required: true, trim: true },   // e.g. "2026-27"
        status:         {
            type: String,
            enum: ["DRAFT", "PENDING_APPROVAL", "APPROVED"],
            default: "DRAFT",
            index: true,
        },
        version:        { type: Number, default: 1 },                   // for future revision support
        rowVersion:     { type: Number, default: 0 },                   // optimistic locking (FR-B10)

        // Creation
        createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

        // Submission
        submittedBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        submittedAt:    { type: Date, default: null },

        // Decision
        decidedBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        decidedAt:      { type: Date, default: null },
        decisionComment:{ type: String, default: null, maxlength: 1000 },

        // Settings snapshot (BRD configurable defaults)
        incomeActualsBasis: { type: String, enum: ["ACCRUAL", "CASH"], default: "ACCRUAL" },
    },
    { timestamps: true }
);

// At most ONE non-DRAFT budget per (society, FY). DRAFT may be re-created after
// a prior one was submitted. The unique constraint is: one APPROVED and/or one
// PENDING_APPROVAL per (societyId, financialYear). The service enforces this.
budgetSchema.index({ societyId: 1, financialYear: 1 });
budgetSchema.index({ societyId: 1, financialYear: 1, status: 1 });

// ── 2. BudgetLine ────────────────────────────────────────────────────────────
const budgetLineSchema = new mongoose.Schema(
    {
        societyId:       { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        budgetId:        { type: mongoose.Schema.Types.ObjectId, ref: "Budget",  required: true, index: true },
        ledgerAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", required: true },
        chargeHeadId:    { type: mongoose.Schema.Types.ObjectId, default: null },   // optional ER fidelity (TODO(BA): confirm)
        accountName:     { type: String, required: true },                          // denormalized for display
        accountCode:     { type: String, required: true },
        accountType:     { type: String, enum: ["INCOME", "EXPENSE"], required: true }, // derived from CoA
        allocatedPaise:  { type: Number, required: true, min: 0, default: 0 },      // INTEGER paise >= 0
        sortOrder:       { type: Number, default: 0 },
    },
    { timestamps: true }
);

// Unique: one line per ledger account per budget (FR-B10 validation)
budgetLineSchema.index({ budgetId: 1, ledgerAccountId: 1 }, { unique: true });
budgetLineSchema.index({ societyId: 1, budgetId: 1 });

// ── 3. BudgetAuditLog (append-only, FR-B12.1 / FR-B12.2 / BRD 6.12) ────────
/**
 * Every state-machine transition AND every saved-line change writes an entry
 * in the SAME DB operation (same callback block). The audit log is never
 * updated or deleted through any API path.
 */
const budgetAuditLogSchema = new mongoose.Schema(
    {
        societyId:     { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        budgetId:      { type: mongoose.Schema.Types.ObjectId, ref: "Budget",  required: true, index: true },
        financialYear: { type: String, required: true },
        userId:        { type: mongoose.Schema.Types.ObjectId, ref: "User",    required: true, index: true },
        userRole:      { type: String, required: true },
        action:        {
            type: String,
            enum: [
                "CREATED",
                "LINES_SAVED",
                "SUBMITTED",
                "APPROVED",
                "SENT_BACK",
                "WITHDRAWN",
            ],
            required: true,
            index: true,
        },
        comment:       { type: String, default: null },
        // For LINES_SAVED: array of { ledgerAccountId, accountName, oldPaise, newPaise }
        lineChanges:   { type: mongoose.Schema.Types.Mixed, default: null },
        timestamp:     { type: Date, default: Date.now, index: true },
    },
    {
        timestamps: false,
        // Prevent any update or delete at the schema level:
        // (enforced by never exposing update/delete routes for this collection)
    }
);

budgetAuditLogSchema.index({ societyId: 1, budgetId: 1, timestamp: -1 });
budgetAuditLogSchema.index({ societyId: 1, userId:  1, timestamp: -1 });

// ── Model Factory (same pattern as ledger.model.js) ──────────────────────────
function getBudgetModels(db) {
    if (!db) {
        const { getOperationsConnection } = require("../../config/operationsDb");
        db = getOperationsConnection();
    }
    return {
        Budget:          db.models.Budget          || db.model("Budget",          budgetSchema),
        BudgetLine:      db.models.BudgetLine      || db.model("BudgetLine",      budgetLineSchema),
        BudgetAuditLog:  db.models.BudgetAuditLog  || db.model("BudgetAuditLog",  budgetAuditLogSchema),
    };
}

module.exports = {
    getBudgetModels,
    budgetSchema,
    budgetLineSchema,
    budgetAuditLogSchema,
};
