"use strict";

const mongoose = require("mongoose");

// ── 1. Charge Head Schema ──────────────────────────────────────────────────
const chargeHeadSchema = new mongoose.Schema(
    {
        societyId:        { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        name:             { type: String, required: true, trim: true },
        code:             { type: String, required: true, uppercase: true, trim: true },
        description:      { type: String, default: "" },
        
        // Category & Calculation
        category:         { type: String, enum: ["INCOME", "EXPENSE"], required: true, default: "INCOME" },
        calculationType:  { type: String, enum: ["FIXED", "PER_SQ_FT"], required: true, default: "FIXED" },
        defaultAmount:    { type: Number, default: 0, min: 0 },
        ratePerSqFt:      { type: Number, default: 0, min: 0 },

        // GST Settings
        gstApplicable:    { type: Boolean, default: false },
        gstRate:          { type: Number, default: null, min: 0 },

        // Applicability
        applicability: {
            residentTypes: { type: [String], enum: ["OWNER", "TENANT"], default: ["OWNER", "TENANT"] },
            allBlocks:     { type: Boolean, default: true },
            selectedBlocks:[{ type: mongoose.Schema.Types.ObjectId, ref: "Block" }],
        },

        // Ledger Mapping
        ledgerAccountId:  { type: String, default: null },

        // Approval & Lifecycle Status
        status:           { type: String, enum: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "ARCHIVED"], default: "PENDING_APPROVAL", index: true },
        isActive:         { type: Boolean, default: true, index: true },
        effectiveFrom:    { type: Date, default: Date.now },
        effectiveTo:      { type: Date, default: null },

        // Audit & Approvals
        createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        updatedBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        approvedBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        approvedAt:       { type: Date, default: null },
        rejectedBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        rejectedAt:       { type: Date, default: null },
        rejectionReason:  { type: String, default: null },

        // Versioning & Historical Immutability
        version:          { type: Number, default: 1 },
        parentChargeHeadId:{ type: mongoose.Schema.Types.ObjectId, ref: "ChargeHead", default: null },
        deletedAt:        { type: Date, default: null, index: true },

        // Legacy compatibility getters / aliases
        title:            { type: String, trim: true },
        type:             { type: String },
        rate:             { type: Number },
        frequency:        { type: String },
    },
    { timestamps: true }
);

// Compound unique indexes for scope isolation per society
chargeHeadSchema.index({ societyId: 1, code: 1, deletedAt: 1 }, { unique: true });

// Sync legacy title / rate properties if not set (async pattern — no next() needed)
chargeHeadSchema.pre("save", async function () {
    if (!this.title) this.title = this.name;
    if (this.rate === undefined || this.rate === null) {
        this.rate = this.calculationType === "FIXED" ? this.defaultAmount : this.ratePerSqFt;
    }
    if (!this.type && this.category) this.type = this.category.toLowerCase();
});

// ── 1B. Billing Configuration Schema ──────────────────────────────────────
const billingConfigurationSchema = new mongoose.Schema(
    {
        societyId:         { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, unique: true, index: true },
        billingFrequency:  { type: String, enum: ["MONTHLY", "QUARTERLY"], default: "MONTHLY" },
        billingDay:        { type: Number, min: 1, max: 28, default: 1 },
        dueDays:           { type: Number, min: 1, max: 90, default: 10 },
        arrearsDisplayMode:{ type: String, enum: ["SINGLE_TOTAL", "LINE_BY_LINE"], default: "SINGLE_TOTAL" },
        defaultTaxSettings:{
            taxName: { type: String, default: "GST" },
            taxRate: { type: Number, default: 18 },
        },
        currency:          { type: String, default: "INR" },
        isActive:          { type: Boolean, default: true },
        createdBy:         { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        updatedBy:         { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
);

// ── 2. Billing Invoice Schema ──────────────────────────────────────────────
const billingInvoiceSchema = new mongoose.Schema(
    {
        societyId:    { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        invoiceNumber:{ type: String, required: true },
        flatId:       { type: mongoose.Schema.Types.ObjectId, ref: "Flat", required: true, index: true },
        userId:       { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        billingPeriod:{ type: String, required: true }, // e.g. "2026-09"
        totalAmount:  { type: Number, required: true, min: 0 },
        paidAmount:   { type: Number, default: 0 },
        status:       { type: String, enum: ["unpaid", "partially_paid", "paid", "overdue"], default: "unpaid", index: true },
        dueDate:      { type: Date, required: true },
        generatedBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        lineItems: [
            {
                chargeHeadId: { type: mongoose.Schema.Types.ObjectId, ref: "ChargeHead" },
                chargeHeadName: String,
                calculationType: String,
                rate: Number,
                baseAmount: Number,
                gstApplicable: Boolean,
                gstRate: Number,
                gstAmount: Number,
                totalAmount: Number,
            },
        ],
    },
    { timestamps: true }
);

// ── 3. Credit Note Schema ──────────────────────────────────────────────────
const creditNoteSchema = new mongoose.Schema(
    {
        societyId:       { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        noteNumber:      { type: String, required: true },
        invoiceId:       { type: mongoose.Schema.Types.ObjectId, ref: "BillingInvoice", required: true },
        flatId:          { type: mongoose.Schema.Types.ObjectId, ref: "Flat", required: true, index: true },
        userId:          { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        amount:          { type: Number, required: true, min: 0.01 },
        reason:          { type: String, required: true },
        status:          { type: String, enum: ["draft", "pending_approval", "approved", "rejected"], default: "pending_approval", index: true },
        createdBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        approvedBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        rejectionReason: { type: String, default: null },
    },
    { timestamps: true }
);

// ── 4. Discount Schema ─────────────────────────────────────────────────────
const discountSchema = new mongoose.Schema(
    {
        societyId:       { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        discountCode:    { type: String, required: true },
        invoiceId:       { type: mongoose.Schema.Types.ObjectId, ref: "BillingInvoice", required: true },
        flatId:          { type: mongoose.Schema.Types.ObjectId, ref: "Flat", required: true, index: true },
        userId:          { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        amount:          { type: Number, required: true, min: 0.01 },
        reason:          { type: String, required: true },
        status:          { type: String, enum: ["draft", "pending_approval", "approved", "rejected"], default: "pending_approval", index: true },
        createdBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        approvedBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        rejectionReason: { type: String, default: null },
    },
    { timestamps: true }
);

// ── 5. Journal Voucher Schema ──────────────────────────────────────────────
const journalVoucherSchema = new mongoose.Schema(
    {
        societyId:    { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        voucherNumber:{ type: String, required: true },
        voucherDate:  { type: Date, default: Date.now },
        entries: [
            {
                accountName: String,
                debit:  { type: Number, default: 0 },
                credit: { type: Number, default: 0 },
            },
        ],
        totalAmount:  { type: Number, required: true, min: 0 },
        narration:    { type: String, required: true },
        status:       { type: String, enum: ["draft", "pending_approval", "approved", "rejected"], default: "pending_approval", index: true },
        createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        approvedBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
);

// ── 6. Vendor Payment Schema ───────────────────────────────────────────────
const vendorPaymentSchema = new mongoose.Schema(
    {
        societyId:    { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        paymentNumber:{ type: String, required: true },
        vendorId:     { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", default: null },
        vendorName:   { type: String, required: true },
        billReference:{ type: String, required: true },
        amount:       { type: Number, required: true, min: 0.01 },
        paymentMode:  { type: String, enum: ["bank_transfer", "cheque", "cash", "upi"], default: "bank_transfer" },
        status:       { type: String, enum: ["draft", "pending_approval", "approved", "rejected"], default: "pending_approval", index: true },
        createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        approvedBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
);

// ── 7. Annual Budget Schema ────────────────────────────────────────────────
const annualBudgetSchema = new mongoose.Schema(
    {
        societyId:        { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        financialYear:    { type: String, required: true }, // e.g. "2026-2027"
        totalBudgetAmount:{ type: Number, required: true, min: 0 },
        status:           { type: String, enum: ["draft", "approved", "rejected"], default: "draft", index: true },
        createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        approvedBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        categories: [
            {
                categoryName: String,
                allocatedAmount: Number,
            },
        ],
    },
    { timestamps: true }
);

// ── 8. Financial Reconciliation Schema ─────────────────────────────────────
const financialReconciliationSchema = new mongoose.Schema(
    {
        societyId:       { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        period:          { type: String, required: true }, // e.g. "2026-08"
        bankBalance:     { type: Number, required: true },
        cashBookBalance: { type: Number, required: true },
        difference:      { type: Number, default: 0 },
        status:          { type: String, enum: ["reconciled", "discrepancy"], default: "reconciled" },
        reconciledBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        notes:           { type: String, default: "" },
    },
    { timestamps: true }
);

// Model helper to obtain models bound to current opsDb connection
function getBillingModels(db) {
    if (!db) {
        const { getOperationsConnection } = require("../../config/operationsDb");
        db = getOperationsConnection();
    }
    return {
        ChargeHead:              db.models.ChargeHead || db.model("ChargeHead", chargeHeadSchema),
        BillingConfiguration:    db.models.BillingConfiguration || db.model("BillingConfiguration", billingConfigurationSchema),
        BillingInvoice:          db.models.BillingInvoice || db.model("BillingInvoice", billingInvoiceSchema),
        CreditNote:              db.models.CreditNote || db.model("CreditNote", creditNoteSchema),
        Discount:                db.models.Discount || db.model("Discount", discountSchema),
        JournalVoucher:          db.models.JournalVoucher || db.model("JournalVoucher", journalVoucherSchema),
        VendorPayment:           db.models.VendorPayment || db.model("VendorPayment", vendorPaymentSchema),
        AnnualBudget:            db.models.AnnualBudget || db.model("AnnualBudget", annualBudgetSchema),
        FinancialReconciliation: db.models.FinancialReconciliation || db.model("FinancialReconciliation", financialReconciliationSchema),
    };
}

module.exports = {
    chargeHeadSchema,
    billingConfigurationSchema,
    billingInvoiceSchema,
    creditNoteSchema,
    discountSchema,
    journalVoucherSchema,
    vendorPaymentSchema,
    annualBudgetSchema,
    financialReconciliationSchema,
    getBillingModels,
};

