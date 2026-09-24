"use strict";

const mongoose = require("mongoose");
const { PAYMENT_STATUS, PAYMENT_METHOD } = require("../../common/constants");

/**
 * FestivalContribution — individual flat's payment toward a festival collection.
 * Lives in mysociety_operations.festivalcontributions
 */
const festivalContributionSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
            index: true,
        },
        festivalCollectionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "FestivalCollection",
            required: [true, "festivalCollectionId is required"],
            index: true,
        },
        flatId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Flat",
            required: [true, "flatId is required"],
            index: true,
        },
        paidBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User", // Resident user ID
            required: [true, "paidBy is required"],
        },
        amount: {
            type: Number,
            required: [true, "Amount is required"],
            min: 0.01,
        },
        status: {
            type: String,
            enum: Object.values(PAYMENT_STATUS),
            default: PAYMENT_STATUS.UNPAID,
            index: true,
        },
        paymentMethod: {
            type: String,
            enum: Object.values(PAYMENT_METHOD),
        },
        paymentSource: {
            type: String,
            enum: ["ONLINE", "OFFLINE"],
        },
        paymentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Payment", // Link to central Payment record
            default: null,
            index: true,
        },
        receiptId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Receipt", // Link to central Receipt record
            default: null,
        },
        transactionRef: {
            type: String,
            trim: true,
        },
        orderId: {
            type: String,
            trim: true,
            default: null,
            index: true,
        },
        gatewayOrderId: {
            type: String,
            trim: true,
            default: null,
            index: true,
        },
        paymentDate: {
            type: Date,
        },
        recordedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User", // Can be self (resident) or accountant/admin
        }
    },
    { timestamps: true }
);

festivalContributionSchema.index({ societyId: 1, festivalCollectionId: 1, flatId: 1 }, { unique: true });

module.exports = festivalContributionSchema;
