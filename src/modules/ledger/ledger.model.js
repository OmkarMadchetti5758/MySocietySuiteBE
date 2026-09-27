"use strict";

const mongoose = require("mongoose");

// ── 1. Chart of Accounts (CoA) ───────────────────────────────────────────────
const chartOfAccountSchema = new mongoose.Schema(
    {
        societyId:         { type: mongoose.Schema.Types.ObjectId, ref: "Society",          required: true, index: true },
        accountCode:       { type: String, required: true, trim: true, uppercase: true },
        accountName:       { type: String, required: true, trim: true },
        accountType:       {
            type: String,
            enum: ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"],
            required: true,
            index: true,
        },
        parentAccountId:   { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount",   default: null },
        description:       { type: String, default: "" },
        normalBalanceType: { type: String, enum: ["DEBIT", "CREDIT"], required: true },
        openingBalance:    { type: Number, default: 0 },
        currentBalance:    { type: Number, default: 0 },
        isSystemAccount:   { type: Boolean, default: false },
        status:            { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE", index: true },
        financialAccountId:{ type: mongoose.Schema.Types.ObjectId, ref: "FinancialAccount", default: null },
        chargeHeadCode:    { type: String, default: null },
        createdBy:         { type: mongoose.Schema.Types.ObjectId, ref: "User",             required: true },
        updatedBy:         { type: mongoose.Schema.Types.ObjectId, ref: "User",             default: null },
    },
    { timestamps: true }
);
chartOfAccountSchema.index({ societyId: 1, accountCode: 1 }, { unique: true });
chartOfAccountSchema.index({ societyId: 1, accountType: 1, status: 1 });
chartOfAccountSchema.index({ societyId: 1, isSystemAccount: 1 });

// ── 2. Accounting Period ─────────────────────────────────────────────────────
const accountingPeriodSchema = new mongoose.Schema(
    {
        societyId:      { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        financialYear:  { type: String, required: true },
        periodName:     { type: String, required: true },
        periodCode:     { type: String, required: true },
        startDate:      { type: Date, required: true },
        endDate:        { type: Date, required: true },
        status:         { type: String, enum: ["OPEN", "CLOSED"], default: "OPEN", index: true },
        closedAt:       { type: Date, default: null },
        closedBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        reopenedAt:     { type: Date, default: null },
        reopenedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        reopenReason:   { type: String, default: null },
        closingSummary: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    { timestamps: true }
);
accountingPeriodSchema.index({ societyId: 1, financialYear: 1 });
accountingPeriodSchema.index({ societyId: 1, periodCode: 1 }, { unique: true });
accountingPeriodSchema.index({ societyId: 1, startDate: 1, endDate: 1 });

// ── 3. Journal Entry (Header) ────────────────────────────────────────────────
const journalEntrySchema = new mongoose.Schema(
    {
        societyId:           { type: mongoose.Schema.Types.ObjectId, ref: "Society",        required: true, index: true },
        journalNumber:       { type: String, required: true, trim: true },
        transactionDate:     { type: Date, required: true, index: true },
        postingDate:         { type: Date, default: null, index: true },
        financialYear:       { type: String, required: true, index: true },
        accountingPeriod:    { type: String, required: true, index: true },
        description:         { type: String, required: true, trim: true },
        referenceType:       {
            type: String,
            enum: [
                "INVOICE", "PAYMENT", "EXPENSE", "ADVANCE_RECEIVED", "ADVANCE_ALLOCATION",
                "ADVANCE_REFUND", "SECURITY_DEPOSIT", "DEPOSIT_REFUND", "TRANSFER",
                "REFUND", "CREDIT_NOTE", "DEBIT_NOTE", "FINE", "INTEREST",
                "ADJUSTMENT", "REVERSAL", "OPENING_BALANCE", "MANUAL"
            ],
            default: "MANUAL",
            index: true,
        },
        referenceId:         { type: String, default: null, index: true },
        referenceNumber:     { type: String, default: null },
        idempotencyKey:      { type: String, default: null, index: true },
        status:              {
            type: String,
            enum: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "POSTED", "REJECTED", "REVERSED"],
            default: "DRAFT",
            index: true,
        },
        totalDebit:          { type: Number, default: 0 },
        totalCredit:         { type: Number, default: 0 },
        isAutomatic:         { type: Boolean, default: false },
        isReversal:          { type: Boolean, default: false },
        reversalOfJournalId: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry",   default: null },
        reversedByJournalId: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry",   default: null },
        reversalReason:      { type: String, default: null },
        residentId:          { type: mongoose.Schema.Types.ObjectId, ref: "User",           default: null, index: true },
        flatId:              { type: mongoose.Schema.Types.ObjectId, ref: "Flat",           default: null, index: true },
        createdBy:           { type: mongoose.Schema.Types.ObjectId, ref: "User",           required: true },
        submittedBy:         { type: mongoose.Schema.Types.ObjectId, ref: "User",           default: null },
        approvedBy:          { type: mongoose.Schema.Types.ObjectId, ref: "User",           default: null },
        approvedAt:          { type: Date, default: null },
        postedBy:            { type: mongoose.Schema.Types.ObjectId, ref: "User",           default: null },
        postedAt:            { type: Date, default: null },
        rejectedBy:          { type: mongoose.Schema.Types.ObjectId, ref: "User",           default: null },
        rejectionReason:     { type: String, default: null },
        notes:               { type: String, default: null },
    },
    { timestamps: true }
);
journalEntrySchema.index({ societyId: 1, journalNumber: 1 }, { unique: true });
journalEntrySchema.index({ societyId: 1, transactionDate: -1, status: 1 });
journalEntrySchema.index({ societyId: 1, financialYear: 1, accountingPeriod: 1 });
journalEntrySchema.index({ societyId: 1, referenceType: 1, referenceId: 1 });
journalEntrySchema.index({ societyId: 1, idempotencyKey: 1 }, { sparse: true });
journalEntrySchema.index({ societyId: 1, residentId: 1, transactionDate: -1 });
journalEntrySchema.index({ societyId: 1, status: 1, isAutomatic: 1 });

// ── 4. Journal Entry Line (Double-Entry Lines) ───────────────────────────────
const journalEntryLineSchema = new mongoose.Schema(
    {
        societyId:            { type: mongoose.Schema.Types.ObjectId, ref: "Society",        required: true, index: true },
        journalId:            { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry",   required: true, index: true },
        accountId:            { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", required: true, index: true },
        debit:                { type: Number, default: 0, min: 0 },
        credit:               { type: Number, default: 0, min: 0 },
        description:          { type: String, default: "" },
        residentId:           { type: mongoose.Schema.Types.ObjectId, ref: "User",           default: null, index: true },
        flatId:               { type: mongoose.Schema.Types.ObjectId, ref: "Flat",           default: null },
        reconciliationStatus: {
            type: String,
            enum: ["UNRECONCILED", "MATCHED", "PARTIALLY_MATCHED", "MANUAL_MATCH", "EXCLUDED"],
            default: "UNRECONCILED",
            index: true,
        },
        reconciliationId:     { type: mongoose.Schema.Types.ObjectId, ref: "ReconciliationSession", default: null },
        runningBalance:       { type: Number, default: null },
    },
    { timestamps: true }
);
journalEntryLineSchema.index({ societyId: 1, journalId: 1 });
journalEntryLineSchema.index({ societyId: 1, accountId: 1, createdAt: -1 });
journalEntryLineSchema.index({ societyId: 1, residentId: 1, createdAt: -1 });
journalEntryLineSchema.index({ societyId: 1, accountId: 1, reconciliationStatus: 1 });

// ── 5. Ledger Audit Log ──────────────────────────────────────────────────────
const ledgerAuditLogSchema = new mongoose.Schema(
    {
        societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        userId:    { type: mongoose.Schema.Types.ObjectId, ref: "User",    required: true, index: true },
        userRole:  { type: String, required: true },
        action:    {
            type: String,
            enum: [
                "ACCOUNT_CREATED", "ACCOUNT_UPDATED", "ACCOUNT_DEACTIVATED",
                "JV_CREATED", "JV_UPDATED", "JV_SUBMITTED", "JV_APPROVED",
                "JV_REJECTED", "JV_POSTED", "JV_REVERSED",
                "ADJUSTMENT_CREATED", "ADJUSTMENT_APPROVED",
                "PERIOD_CREATED", "PERIOD_CLOSED", "PERIOD_REOPENED",
                "COA_SEEDED", "EXPORT", "ACCESS_DENIED",
            ],
            required: true,
            index: true,
        },
        entity:    { type: String, required: true },
        entityId:  { type: String, default: null },
        oldValue:  { type: mongoose.Schema.Types.Mixed, default: null },
        newValue:  { type: mongoose.Schema.Types.Mixed, default: null },
        reason:    { type: String, default: null },
        ipAddress: { type: String, default: null },
        timestamp: { type: Date, default: Date.now, index: true },
    },
    { timestamps: false }
);
ledgerAuditLogSchema.index({ societyId: 1, timestamp: -1 });
ledgerAuditLogSchema.index({ societyId: 1, entity: 1, entityId: 1 });
ledgerAuditLogSchema.index({ societyId: 1, userId: 1, timestamp: -1 });

// ── Model Factory ────────────────────────────────────────────────────────────
function getLedgerModels(db) {
    if (!db) {
        const { getOperationsConnection } = require("../../config/operationsDb");
        db = getOperationsConnection();
    }
    return {
        ChartOfAccount:    db.models.ChartOfAccount    || db.model("ChartOfAccount",    chartOfAccountSchema),
        AccountingPeriod:  db.models.AccountingPeriod  || db.model("AccountingPeriod",  accountingPeriodSchema),
        JournalEntry:      db.models.JournalEntry      || db.model("JournalEntry",      journalEntrySchema),
        JournalEntryLine:  db.models.JournalEntryLine  || db.model("JournalEntryLine",  journalEntryLineSchema),
        LedgerAuditLog:    db.models.LedgerAuditLog    || db.model("LedgerAuditLog",    ledgerAuditLogSchema),
    };
}

module.exports = {
    getLedgerModels,
    chartOfAccountSchema,
    accountingPeriodSchema,
    journalEntrySchema,
    journalEntryLineSchema,
    ledgerAuditLogSchema,
};
