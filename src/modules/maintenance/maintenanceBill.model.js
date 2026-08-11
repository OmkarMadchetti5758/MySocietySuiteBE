"use strict";

const mongoose = require("mongoose");
const { MAINTENANCE_STATUS, PAYMENT_STATUS } = require("../../common/constants");

/**
 * MaintenanceBill — monthly/quarterly maintenance charges per flat.
 * Lives in mysociety_operations.maintenancebills
 */
const maintenanceBillSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        flatId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Flat",
            required: [true, "flatId is required"],
        },
        billingPeriod: {
            type: String, // e.g. "2024-08" (YYYY-MM)
            required: [true, "Billing period is required"],
            trim: true,
        },
        amount: {
            type: Number,
            required: [true, "Amount is required"],
            min: 0,
        },
        dueDate: {
            type: Date,
            required: [true, "Due date is required"],
        },
        status: {
            type: String,
            enum: Object.values(MAINTENANCE_STATUS),
            default: MAINTENANCE_STATUS.PENDING,
        },
        paymentStatus: {
            type: String,
            enum: Object.values(PAYMENT_STATUS),
            default: PAYMENT_STATUS.UNPAID,
        },
        breakdown: {
            maintenance: { type: Number, default: 0 },
            water: { type: Number, default: 0 },
            parking: { type: Number, default: 0 },
            others: { type: Number, default: 0 },
        },
        remarks: {
            type: String,
            trim: true,
        },
        generatedAt: {
            type: Date,
            default: Date.now,
        },
    },
    { timestamps: true }
);

maintenanceBillSchema.index({ societyId: 1, flatId: 1, billingPeriod: 1 });
maintenanceBillSchema.index({ societyId: 1, dueDate: 1 });

module.exports = maintenanceBillSchema;
