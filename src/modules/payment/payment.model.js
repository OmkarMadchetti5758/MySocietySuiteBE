"use strict";

const mongoose = require("mongoose");

// ── 1. Payment Schema ──────────────────────────────────────────────────────
const paymentSchema = new mongoose.Schema(
    {
        societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        flatId: { type: mongoose.Schema.Types.ObjectId, ref: "Flat", required: true, index: true },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "BillingInvoice", default: null, index: true },
        paymentAccountId: { type: String, required: true, index: true }, // e.g. "HDFC_COLLECTION_ACC" or BankAccount ID
        paymentAccountName: { type: String, default: "Collection Account" },

        paymentNumber: { type: String, required: true, unique: true, index: true }, // PAY-2026-XXXXX
        amount: { type: Number, required: true, min: 0.01 },
        excessAmount: { type: Number, default: 0, min: 0 }, // Amount sent to Advance Account

        paymentMode: {
            type: String,
            enum: ["UPI", "CARD", "NET_BANKING", "CASH", "CHEQUE", "BANK_TRANSFER", "ONLINE", "OTHER"],
            required: true,
        },
        paymentSource: {
            type: String,
            enum: ["ONLINE", "OFFLINE"],
            required: true,
            index: true,
        },
        paymentStatus: {
            type: String,
            enum: ["INITIATED", "PENDING", "SUCCESS", "FAILED", "CANCELLED", "REFUNDED"],
            default: "INITIATED",
            index: true,
        },
        reconciliationStatus: {
            type: String,
            enum: ["UNRECONCILED", "RECONCILED", "MATCH_FAILED", "MANUAL_REVIEW"],
            default: "UNRECONCILED",
            index: true,
        },

        // Gateway transaction references for online payments
        gatewayOrderId: { type: String, default: null, index: true },
        gatewayTransactionId: { type: String, default: null, index: true, sparse: true }, // unique index sparse
        gatewaySignature: { type: String, default: null },
        transactionReference: { type: String, default: null, index: true }, // Reference number for offline payments or gateway ref

        // Offline payment details
        chequeDetails: {
            chequeNumber: { type: String, default: null },
            bankName: { type: String, default: null },
            chequeDate: { type: Date, default: null },
        },
        bankTransferDetails: {
            bankName: { type: String, default: null },
        },

        receiptId: { type: mongoose.Schema.Types.ObjectId, ref: "Receipt", default: null },
        receiptNumber: { type: String, default: null, index: true },

        paymentDate: { type: Date, default: Date.now, index: true },
        recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        notes: { type: String, default: "" },
        failureReason: { type: String, default: null },
    },
    { timestamps: true }
);

// Indexes
paymentSchema.index({ societyId: 1, paymentDate: -1 });
paymentSchema.index({ societyId: 1, paymentStatus: 1 });
paymentSchema.index({ societyId: 1, reconciliationStatus: 1 });

// ── 2. Receipt Schema ──────────────────────────────────────────────────────
const receiptSchema = new mongoose.Schema(
    {
        societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        receiptNumber: { type: String, required: true, unique: true, index: true }, // REC/2026-27/000001
        paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", required: true, index: true },
        invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "BillingInvoice", default: null, index: true },
        invoiceNumber: { type: String, default: "" },
        flatId: { type: mongoose.Schema.Types.ObjectId, ref: "Flat", required: true, index: true },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        residentName: { type: String, default: "" },
        flatNumber: { type: String, default: "" },
        blockName: { type: String, default: "" },
        societyName: { type: String, default: "" },

        amount: { type: Number, required: true, min: 0.01 },
        amountInWords: { type: String, default: "" },
        paymentMode: { type: String, required: true },
        paymentAccountName: { type: String, default: "" },
        transactionRef: { type: String, default: "" },

        invoiceTotalAmount: { type: Number, default: 0 },
        previousPaidAmount: { type: Number, default: 0 },
        currentPaidAmount: { type: Number, default: 0 },
        remainingBalance: { type: Number, default: 0 },

        generatedAt: { type: Date, default: Date.now },
        generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    },
    { timestamps: true }
);

// ── 3. Advance Account Schema ──────────────────────────────────────────────
const advanceAccountSchema = new mongoose.Schema(
    {
        societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        flatId: { type: mongoose.Schema.Types.ObjectId, ref: "Flat", required: true, index: true },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        advanceBalance: { type: Number, default: 0, min: 0 },
        securityDepositBalance: { type: Number, default: 0, min: 0 }, // STRICTLY SEPARATE FROM GENERAL ADVANCE

        transactions: [
            {
                type: { type: String, enum: ["CREDIT", "DEBIT"], required: true },
                accountType: { type: String, enum: ["ADVANCE", "SECURITY_DEPOSIT"], default: "ADVANCE" },
                amount: { type: Number, required: true, min: 0.01 },
                referencePaymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", default: null },
                referenceInvoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "BillingInvoice", default: null },
                description: { type: String, default: "" },
                date: { type: Date, default: Date.now },
                recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            },
        ],
    },
    { timestamps: true }
);

advanceAccountSchema.index({ societyId: 1, flatId: 1 }, { unique: true });

function getPaymentModels(db) {
    if (!db) {
        const { getOperationsConnection } = require("../../config/operationsDb");
        db = getOperationsConnection();
    }
    return {
        Payment: db.models.Payment || db.model("Payment", paymentSchema),
        Receipt: db.models.Receipt || db.model("Receipt", receiptSchema),
        AdvanceAccount: db.models.AdvanceAccount || db.model("AdvanceAccount", advanceAccountSchema),
    };
}

module.exports = {
    paymentSchema,
    receiptSchema,
    advanceAccountSchema,
    getPaymentModels,
};