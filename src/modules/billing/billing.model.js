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
        societyId:      { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        invoiceNumber:  { type: String, required: true },
        flatId:         { type: mongoose.Schema.Types.ObjectId, ref: "Flat", required: true, index: true },

        // Resident at time of generation (snapshot)
        userId:         { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        residentName:   { type: String, default: "" },
        flatNumber:     { type: String, default: "" },
        blockName:      { type: String, default: "" },

        // Period & Dates
        billingPeriod:  { type: String, required: true }, // e.g. "2026-09"
        invoiceDate:    { type: Date, default: Date.now },
        dueDate:        { type: Date, required: true },

        // Amounts
        subTotal:       { type: Number, default: 0, min: 0 },   // sum of base charges
        totalGst:       { type: Number, default: 0, min: 0 },
        cgst:           { type: Number, default: 0 },
        sgst:           { type: Number, default: 0 },
        arrearsAmount:  { type: Number, default: 0, min: 0 },
        fineAmount:     { type: Number, default: 0, min: 0 },
        creditNoteAmount:   { type: Number, default: 0, min: 0 },
        discountAmount:     { type: Number, default: 0, min: 0 },
        advanceAdjustment:  { type: Number, default: 0, min: 0 },
        totalAmount:    { type: Number, required: true, min: 0 },
        paidAmount:     { type: Number, default: 0 },

        // Lifecycle Status
        // NEW invoices use uppercase states; legacy data may have lowercase
        status: {
            type: String,
            enum: [
                "DRAFT", "GENERATED", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED",
                // backward-compat legacy values
                "unpaid", "partially_paid", "paid", "overdue",
            ],
            default: "GENERATED",
            index: true,
        },

        // Charge line items
        lineItems: [
            {
                chargeHeadId:    { type: mongoose.Schema.Types.ObjectId, ref: "ChargeHead" },
                chargeHeadName:  String,
                chargeHeadCode:  String,
                calculationType: String,
                rate:            Number,
                quantity:        Number,   // sq ft for PER_SQ_FT
                baseAmount:      Number,
                gstApplicable:   Boolean,
                gstRate:         Number,
                gstAmount:       Number,
                totalAmount:     Number,
            },
        ],

        // Arrears snapshot (line-by-line or single total per config)
        arrearsBreakdown: [
            {
                billingPeriod: String,
                amount:        Number,
                invoiceId:     { type: mongoose.Schema.Types.ObjectId, ref: "BillingInvoice" },
            },
        ],

        // Generation metadata
        generatedBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        generatedAt:    { type: Date, default: Date.now },
        isBulk:         { type: Boolean, default: false },
        bulkJobId:      { type: String, default: null },

        // Cancellation
        cancelledBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        cancelledAt:        { type: Date, default: null },
        cancellationReason: { type: String, default: null },
    },
    { timestamps: true }
);

// ── Duplicate Prevention: same society + flat + billing period must be unique ──
billingInvoiceSchema.index(
    { societyId: 1, flatId: 1, billingPeriod: 1 },
    { unique: true, partialFilterExpression: { status: { $nin: ["CANCELLED"] } } }
);
billingInvoiceSchema.index({ societyId: 1, invoiceNumber: 1 }, { unique: true });

// ── 2B. One-Time Charge Schema ─────────────────────────────────────────────
const oneTimeChargeSchema = new mongoose.Schema(
    {
        societyId:    { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        flatId:       { type: mongoose.Schema.Types.ObjectId, ref: "Flat", required: true, index: true },
        userId:       { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        chargeHeadId: { type: mongoose.Schema.Types.ObjectId, ref: "ChargeHead", default: null },
        description:  { type: String, required: true, trim: true },
        amount:       { type: Number, required: true, min: 0 },
        taxRate:      { type: Number, default: 0 },
        taxAmount:    { type: Number, default: 0 },
        totalAmount:  { type: Number, required: true },
        billingPeriod:{ type: String, required: true },
        effectiveDate:{ type: Date, default: Date.now },
        invoiceId:    { type: mongoose.Schema.Types.ObjectId, ref: "BillingInvoice", default: null },
        status:       { type: String, enum: ["PENDING", "INCLUDED", "CANCELLED"], default: "PENDING", index: true },
        createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    },
    { timestamps: true }
);

// ── 2C. Invoice Payment Schema ─────────────────────────────────────────────
const invoicePaymentSchema = new mongoose.Schema(
    {
        societyId:      { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        invoiceId:      { type: mongoose.Schema.Types.ObjectId, ref: "BillingInvoice", required: true, index: true },
        flatId:         { type: mongoose.Schema.Types.ObjectId, ref: "Flat", required: true, index: true },
        userId:         { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        amountPaid:     { type: Number, required: true, min: 0.01 },
        paymentMode:    {
            type: String,
            enum: ["CASH", "CHEQUE", "BANK_TRANSFER", "UPI", "ONLINE", "OTHER"],
            default: "CASH",
        },
        paymentAccount: { type: String, default: null },  // e.g. "HDFC - Collection A/c"
        paymentDate:    { type: Date, default: Date.now },
        receiptNumber:  { type: String, default: null },
        referenceNumber:{ type: String, default: null },
        notes:          { type: String, default: "" },
        paymentType:    { type: String, enum: ["OFFLINE", "ONLINE"], default: "OFFLINE" },
        recordedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        // For advance excess handling
        excessAmount:   { type: Number, default: 0 },
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
        OneTimeCharge:           db.models.OneTimeCharge || db.model("OneTimeCharge", oneTimeChargeSchema),
        InvoicePayment:          db.models.InvoicePayment || db.model("InvoicePayment", invoicePaymentSchema),
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
    oneTimeChargeSchema,
    invoicePaymentSchema,
    creditNoteSchema,
    discountSchema,
    journalVoucherSchema,
    vendorPaymentSchema,
    annualBudgetSchema,
    financialReconciliationSchema,
    getBillingModels,
};

