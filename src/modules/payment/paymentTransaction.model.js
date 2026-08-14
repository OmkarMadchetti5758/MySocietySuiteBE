"use strict";

const mongoose = require("mongoose");
const { PAYMENT_METHOD, PAYMENT_STATUS } = require("../../common/constants");

/**
 * PaymentTransaction — records an actual payment against a maintenance bill.
 * Lives in mysociety_operations.paymenttransactions
 */
const paymentTransactionSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        billId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "MaintenanceBill",
            required: [true, "billId is required"],
        },
        flatId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Flat",
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "userId is required"],
        },
        amount: {
            type: Number,
            required: [true, "Amount is required"],
            min: 0,
        },
        date: {
            type: Date,
            default: Date.now,
            required: [true, "Payment date is required"],
        },
        method: {
            type: String,
            enum: Object.values(PAYMENT_METHOD),
            required: [true, "Payment method is required"],
        },
        status: {
            type: String,
            enum: Object.values(PAYMENT_STATUS),
            default: PAYMENT_STATUS.PAID,
        },
        transactionRef: {
            type: String,
            trim: true,
        },
        receiptNumber: {
            type: String,
            trim: true,
        },
        notes: {
            type: String,
            trim: true,
        },
    },
    { timestamps: true }
);

paymentTransactionSchema.index({ societyId: 1, billId: 1 });
paymentTransactionSchema.index({ societyId: 1, date: -1 });

module.exports = paymentTransactionSchema;
