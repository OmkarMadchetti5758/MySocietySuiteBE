"use strict";

const mongoose = require("mongoose");

// ── 1. Resident Advance Account ─────────────────────────────────────────────
const residentAdvanceAccountSchema = new mongoose.Schema(
    {
        societyId:      { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        residentId:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        flatId:         { type: mongoose.Schema.Types.ObjectId, ref: "Flat", required: true, index: true },
        accountNumber:  { type: String, default: null }, // Auto-generated
        openingBalance: { type: Number, default: 0, min: 0 },
        currentBalance: { type: Number, default: 0 },
        status:         {
            type: String,
            enum: ["ACTIVE", "ZERO_BALANCE", "BLOCKED", "CLOSED"],
            default: "ACTIVE",
            index: true,
        },
        notes:          { type: String, default: "" },
        createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        updatedBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
);

// One active advance account per resident per society
residentAdvanceAccountSchema.index(
    { societyId: 1, residentId: 1, status: 1 },
    { unique: true, partialFilterExpression: { status: "ACTIVE" } }
);
residentAdvanceAccountSchema.index({ societyId: 1, flatId: 1 });

// ── 2. Advance Transaction ───────────────────────────────────────────────────
const advanceTransactionSchema = new mongoose.Schema(
    {
        societyId:              { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        advanceAccountId:       { type: mongoose.Schema.Types.ObjectId, ref: "ResidentAdvanceAccount", required: true, index: true },
        residentId:             { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        flatId:                 { type: mongoose.Schema.Types.ObjectId, ref: "Flat", required: true },
        transactionType:        {
            type: String,
            enum: [
                "ADVANCE_RECEIVED",
                "INVOICE_ALLOCATION",
                "ADVANCE_REFUND",
                "ADVANCE_ADJUSTMENT",
                "REVERSAL",
                "OPENING_BALANCE",
            ],
            required: true,
            index: true,
        },
        direction:              { type: String, enum: ["CREDIT", "DEBIT"], required: true },
        amount:                 { type: Number, required: true, min: 0.01 },
        balanceAfterTransaction:{ type: Number, required: true },
        referenceType:          { type: String, default: null }, // "Invoice", "Payment", "ManualAdjustment", etc.
        referenceId:            { type: String, default: null },
        description:            { type: String, default: "" },
        idempotencyKey:         { type: String, default: null, index: true },
        createdBy:              { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    },
    { timestamps: true }
);

advanceTransactionSchema.index({ societyId: 1, advanceAccountId: 1, createdAt: -1 });
advanceTransactionSchema.index({ societyId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

// ── 3. Advance Allocation ────────────────────────────────────────────────────
const advanceAllocationSchema = new mongoose.Schema(
    {
        societyId:        { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        advanceAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ResidentAdvanceAccount", required: true, index: true },
        residentId:       { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        flatId:           { type: mongoose.Schema.Types.ObjectId, ref: "Flat", required: true },
        invoiceId:        { type: mongoose.Schema.Types.ObjectId, ref: "BillingInvoice", required: true, index: true },
        amount:           { type: Number, required: true, min: 0.01 },
        allocationDate:   { type: Date, default: Date.now },
        status:           {
            type: String,
            enum: ["ACTIVE", "REVERSED"],
            default: "ACTIVE",
            index: true,
        },
        idempotencyKey:   { type: String, default: null, index: true },
        createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        // Reversal fields
        reversedBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        reversedAt:       { type: Date, default: null },
        reversalReason:   { type: String, default: null },
        reversalTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: "AdvanceTransaction", default: null },
    },
    { timestamps: true }
);

advanceAllocationSchema.index({ societyId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

// ── 4. Security Deposit Type ────────────────────────────────────────────────
const securityDepositTypeSchema = new mongoose.Schema(
    {
        societyId:       { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        name:            { type: String, required: true, trim: true },
        description:     { type: String, default: "" },
        defaultAmount:   { type: Number, default: 0, min: 0 },
        refundable:      { type: Boolean, default: true },
        approvalRequired:{ type: Boolean, default: false },
        status:          { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE", index: true },
        createdBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        updatedBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
);

securityDepositTypeSchema.index({ societyId: 1, name: 1 }, { unique: true });

// ── 5. Security Deposit ──────────────────────────────────────────────────────
const securityDepositSchema = new mongoose.Schema(
    {
        societyId:        { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        residentId:       { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        flatId:           { type: mongoose.Schema.Types.ObjectId, ref: "Flat", required: true, index: true },
        depositTypeId:    { type: mongoose.Schema.Types.ObjectId, ref: "SecurityDepositType", required: false, default: null },
        depositTypeName:  { type: String, default: "" }, // Snapshot
        originalAmount:   { type: Number, required: true, min: 0.01 },
        collectedAmount:  { type: Number, default: 0, min: 0 },
        adjustedAmount:   { type: Number, default: 0, min: 0 },
        refundedAmount:   { type: Number, default: 0, min: 0 },
        refundableBalance:{ type: Number, default: 0 }, // originalAmount - adjustedAmount - refundedAmount
        receivedDate:     { type: Date, default: Date.now },
        refundable:       { type: Boolean, default: true },
        reference:        { type: String, default: null },
        paymentMethod:    {
            type: String,
            enum: ["CASH", "CHEQUE", "BANK_TRANSFER", "UPI", "NET_BANKING", "OTHER"],
            default: "CASH",
        },
        paymentAccountId: { type: String, default: null },
        paymentAccountName:{ type: String, default: null },
        notes:            { type: String, default: "" },
        status:           {
            type: String,
            enum: [
                "PENDING",
                "ACTIVE",
                "PARTIALLY_ADJUSTED",
                "REFUND_PENDING",
                "PARTIALLY_REFUNDED",
                "REFUNDED",
                "CLOSED",
                "CANCELLED",
            ],
            default: "PENDING",
            index: true,
        },
        idempotencyKey:   { type: String, default: null, index: true },
        createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        updatedBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
);

securityDepositSchema.index({ societyId: 1, residentId: 1, status: 1 });
securityDepositSchema.index({ societyId: 1, flatId: 1, status: 1 });
securityDepositSchema.index({ societyId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

// ── 6. Security Deposit Transaction ─────────────────────────────────────────
const securityDepositTransactionSchema = new mongoose.Schema(
    {
        societyId:         { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        securityDepositId: { type: mongoose.Schema.Types.ObjectId, ref: "SecurityDeposit", required: true, index: true },
        residentId:        { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        flatId:            { type: mongoose.Schema.Types.ObjectId, ref: "Flat", required: true },
        transactionType:   {
            type: String,
            enum: [
                "DEPOSIT_COLLECTED",
                "DEPOSIT_ADJUSTED",
                "DEPOSIT_REFUNDED",
                "DEPOSIT_CANCELLED",
            ],
            required: true,
            index: true,
        },
        direction:         { type: String, enum: ["CREDIT", "DEBIT"], required: true },
        amount:            { type: Number, required: true, min: 0.01 },
        referenceType:     { type: String, default: null },
        referenceId:       { type: String, default: null },
        reason:            { type: String, default: "" },
        description:       { type: String, default: "" },
        idempotencyKey:    { type: String, default: null, index: true },
        createdBy:         { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    },
    { timestamps: true }
);

securityDepositTransactionSchema.index({ societyId: 1, securityDepositId: 1, createdAt: -1 });
securityDepositTransactionSchema.index({ societyId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

// ── 7. Deposit Refund Request ────────────────────────────────────────────────
const depositRefundRequestSchema = new mongoose.Schema(
    {
        societyId:          { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        securityDepositId:  { type: mongoose.Schema.Types.ObjectId, ref: "SecurityDeposit", required: true, index: true },
        residentId:         { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        flatId:             { type: mongoose.Schema.Types.ObjectId, ref: "Flat", required: true },
        requestedAmount:    { type: Number, required: true, min: 0.01 },
        approvedAmount:     { type: Number, default: null },
        deductionAmount:    { type: Number, default: 0, min: 0 },
        deductionBreakdown: [{ label: String, amount: Number }],
        reason:             { type: String, required: true },
        paymentMethod:      {
            type: String,
            enum: ["BANK_TRANSFER", "UPI", "CHEQUE", "CASH", "OTHER"],
            default: "BANK_TRANSFER",
        },
        refundAccountId:    { type: String, default: null },
        refundAccountName:  { type: String, default: null },
        bankDetails:        {
            accountNumber: { type: String, default: null },
            ifscCode:      { type: String, default: null },
            bankName:      { type: String, default: null },
            accountHolderName: { type: String, default: null },
        },
        upiId:              { type: String, default: null },
        status:             {
            type: String,
            enum: [
                "REQUESTED",
                "UNDER_REVIEW",
                "APPROVED",
                "REJECTED",
                "PROCESSING",
                "COMPLETED",
                "FAILED",
                "CANCELLED",
            ],
            default: "REQUESTED",
            index: true,
        },
        idempotencyKey:     { type: String, default: null, index: true },
        requestedBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        approvedBy:         { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        approvedAt:         { type: Date, default: null },
        rejectedBy:         { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        rejectedAt:         { type: Date, default: null },
        rejectionReason:    { type: String, default: null },
        processedBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        processedAt:        { type: Date, default: null },
        referenceNumber:    { type: String, default: null },
        notes:              { type: String, default: "" },
    },
    { timestamps: true }
);

depositRefundRequestSchema.index({ societyId: 1, securityDepositId: 1, status: 1 });
depositRefundRequestSchema.index({ societyId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

// ── Model Factory ────────────────────────────────────────────────────────────
function getAdvanceDepositModels(db) {
    if (!db) {
        const { getOperationsConnection } = require("../../config/operationsDb");
        db = getOperationsConnection();
    }
    return {
        ResidentAdvanceAccount:    db.models.ResidentAdvanceAccount    || db.model("ResidentAdvanceAccount",    residentAdvanceAccountSchema),
        AdvanceTransaction:        db.models.AdvanceTransaction        || db.model("AdvanceTransaction",        advanceTransactionSchema),
        AdvanceAllocation:         db.models.AdvanceAllocation         || db.model("AdvanceAllocation",         advanceAllocationSchema),
        SecurityDepositType:       db.models.SecurityDepositType       || db.model("SecurityDepositType",       securityDepositTypeSchema),
        SecurityDeposit:           db.models.SecurityDeposit           || db.model("SecurityDeposit",           securityDepositSchema),
        SecurityDepositTransaction:db.models.SecurityDepositTransaction|| db.model("SecurityDepositTransaction", securityDepositTransactionSchema),
        DepositRefundRequest:      db.models.DepositRefundRequest       || db.model("DepositRefundRequest",      depositRefundRequestSchema),
    };
}

module.exports = {
    residentAdvanceAccountSchema,
    advanceTransactionSchema,
    advanceAllocationSchema,
    securityDepositTypeSchema,
    securityDepositSchema,
    securityDepositTransactionSchema,
    depositRefundRequestSchema,
    getAdvanceDepositModels,
};
