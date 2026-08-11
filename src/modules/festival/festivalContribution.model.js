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
        },
        festivalCollectionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "FestivalCollection",
            required: [true, "festivalCollectionId is required"],
        },
        flatId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Flat",
            required: [true, "flatId is required"],
        },
        paidBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "paidBy is required"],
        },
        amount: {
            type: Number,
            required: [true, "Amount is required"],
            min: 0,
        },
        status: {
            type: String,
            enum: Object.values(PAYMENT_STATUS),
            default: PAYMENT_STATUS.UNPAID,
        },
        paymentMethod: {
            type: String,
            enum: Object.values(PAYMENT_METHOD),
        },
        transactionRef: {
            type: String,
            trim: true,
        },
        paidAt: {
            type: Date,
        },
    },
    { timestamps: true }
);

festivalContributionSchema.index({ societyId: 1, festivalCollectionId: 1, flatId: 1 });
festivalContributionSchema.index({ societyId: 1, festivalCollectionId: 1 });

module.exports = festivalContributionSchema;
