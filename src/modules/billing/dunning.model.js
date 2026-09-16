"use strict";

const mongoose = require("mongoose");

// ── 1. Fine & Interest Rule Schema ──────────────────────────────────────────
const fineRuleSchema = new mongoose.Schema(
    {
        societyId:       { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        ruleName:        { type: String, required: true, trim: true },
        calculationType: { type: String, enum: ["FLAT", "PERCENTAGE", "SLAB"], required: true },
        
        // Calculation values
        flatAmount:      { type: Number, default: 0, min: 0 },
        percentageRate:  { type: Number, default: 0, min: 0 },
        slabs: [
            {
                fromDays: { type: Number, required: true, min: 0 },
                toDays:   { type: Number, required: true, min: 0 },
                rate:     { type: Number, required: true, min: 0 },
            }
        ],

        // Calculation Start Date reference (Mandatory explicit selection)
        startRule:       { type: String, enum: ["INVOICE_DATE", "DUE_DATE"], required: true },

        // Rule Applicability
        applyTo:         { type: String, enum: ["ALL", "SELECTED_CHARGE_HEADS", "SELECTED_BLOCKS", "SELECTED_FLATS"], default: "ALL" },
        chargeHeadIds:   [{ type: mongoose.Schema.Types.ObjectId, ref: "ChargeHead" }],

        // Status & Approval
        status:          { type: String, enum: ["PENDING_APPROVAL", "ACTIVE", "INACTIVE", "REJECTED"], default: "PENDING_APPROVAL", index: true },
        effectiveFrom:   { type: Date, default: Date.now },

        createdBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        approvedBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        approvedAt:      { type: Date, default: null },
        rejectionReason: { type: String, default: null },
    },
    { timestamps: true }
);

// ── 2. Fine Application Record (Idempotent tracking) ────────────────────────
const fineApplicationSchema = new mongoose.Schema(
    {
        societyId:     { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        invoiceId:     { type: mongoose.Schema.Types.ObjectId, ref: "BillingInvoice", required: true, index: true },
        flatId:        { type: mongoose.Schema.Types.ObjectId, ref: "Flat", default: null, index: true },
        fineRuleId:    { type: mongoose.Schema.Types.ObjectId, ref: "FineRule", required: true },
        fineAmount:    { type: Number, required: true, min: 0 },
        billingCycle:  { type: String, required: true },
        appliedAt:     { type: Date, default: Date.now },
        idempotencyKey:{ type: String, required: true, unique: true, index: true },
        status:        { type: String, enum: ["APPLIED", "WAIVED", "PARTIALLY_WAIVED"], default: "APPLIED" }
    },
    { timestamps: true }
);

// ── 3. Defaulter Record Schema ──────────────────────────────────────────────
const defaulterRecordSchema = new mongoose.Schema(
    {
        societyId:         { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        flatId:            { type: mongoose.Schema.Types.ObjectId, ref: "Flat", default: null, index: true },
        flatNumber:        { type: String, default: "A-101" },
        residentName:      { type: String, default: "" },
        unpaidCyclesCount: { type: Number, required: true, default: 0 },
        totalOutstanding:  { type: Number, required: true, default: 0 },
        oldestDueDate:     { type: Date, default: null },
        daysOverdue:       { type: Number, default: 0 },
        totalFineAmount:   { type: Number, default: 0 },
        lastReminderSentAt:{ type: Date, default: null },
        defaulterSince:    { type: Date, default: Date.now },
        status:            { type: String, enum: ["DEFAULTER", "RESOLVED"], default: "DEFAULTER", index: true }
    },
    { timestamps: true }
);

// ── 4. Dunning Reminder History Schema ───────────────────────────────────────
const dunningReminderSchema = new mongoose.Schema(
    {
        societyId:     { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        invoiceId:     { type: mongoose.Schema.Types.ObjectId, ref: "BillingInvoice", default: null, index: true },
        flatId:        { type: mongoose.Schema.Types.ObjectId, ref: "Flat", default: null, index: true },
        flatNumber:    { type: String, default: "A-101" },
        residentName:  { type: String, default: "" },
        reminderType:  { type: String, enum: ["BEFORE_DUE_DATE", "ON_DUE_DATE", "AFTER_DUE_DATE", "SECOND_REMINDER", "DEFAULTER_FOLLOWUP"], required: true },
        channel:       { type: String, enum: ["PUSH", "SMS", "EMAIL"], required: true },
        sentAt:        { type: Date, default: Date.now },
        deliveryStatus:{ type: String, enum: ["DELIVERED", "SENT", "FAILED"], default: "DELIVERED" },
        failureReason: { type: String, default: null }
    },
    { timestamps: true }
);

// ── 5. Fine Waiver Schema ───────────────────────────────────────────────────
const fineWaiverSchema = new mongoose.Schema(
    {
        societyId:        { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
        invoiceId:        { type: mongoose.Schema.Types.ObjectId, ref: "BillingInvoice", default: null, index: true },
        fineApplicationId:{ type: mongoose.Schema.Types.ObjectId, ref: "FineApplication", default: null },
        flatId:           { type: mongoose.Schema.Types.ObjectId, ref: "Flat", default: null },
        flatNumber:       { type: String, required: true },
        residentName:     { type: String, default: "" },
        originalFine:     { type: Number, required: true },
        waivedAmount:     { type: Number, required: true },
        reason:           { type: String, required: true, trim: true },
        waivedBy:         { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        waivedByName:     { type: String, default: "Committee Admin" },
        waivedAt:         { type: Date, default: Date.now },
        status:           { type: String, enum: ["APPROVED"], default: "APPROVED" }
    },
    { timestamps: true }
);

// ── 6. Dunning Society Configuration Schema ─────────────────────────────────
const dunningConfigSchema = new mongoose.Schema(
    {
        societyId:                     { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, unique: true, index: true },
        defaulterUnpaidCyclesThreshold:{ type: Number, default: 2, min: 1 },
        beforeDueDays:                 { type: Number, default: 3, min: 0 },
        onDueDateEnabled:              { type: Boolean, default: true },
        afterDueDays:                  { type: Number, default: 3, min: 0 },
        secondReminderDays:            { type: Number, default: 7, min: 0 },
        autoApplyFineCronEnabled:      { type: Boolean, default: true },
        updatedBy:                     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
    },
    { timestamps: true }
);

function getDunningModels(db) {
    if (!db) {
        const { getOperationsConnection } = require("../../config/operationsDb");
        db = getOperationsConnection();
    }
    return {
        FineRule:        db.models.FineRule || db.model("FineRule", fineRuleSchema),
        FineApplication: db.models.FineApplication || db.model("FineApplication", fineApplicationSchema),
        DefaulterRecord: db.models.DefaulterRecord || db.model("DefaulterRecord", defaulterRecordSchema),
        DunningReminder: db.models.DunningReminder || db.model("DunningReminder", dunningReminderSchema),
        FineWaiver:      db.models.FineWaiver || db.model("FineWaiver", fineWaiverSchema),
        DunningConfig:   db.models.DunningConfig || db.model("DunningConfig", dunningConfigSchema),
    };
}

module.exports = {
    fineRuleSchema,
    fineApplicationSchema,
    defaulterRecordSchema,
    dunningReminderSchema,
    fineWaiverSchema,
    dunningConfigSchema,
    getDunningModels
};
