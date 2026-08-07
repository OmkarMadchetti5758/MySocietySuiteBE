"use strict";

const mongoose = require("mongoose");
const { SUBSCRIPTION_STATUS } = require("../../common/constants");

const subscriptionSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: true,
        },
        planId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SubscriptionPlan",
            required: true,
        },
        startDate: {
            type: Date,
            required: true,
            default: Date.now,
        },
        endDate: {
            type: Date,
            required: true,
        },
        status: {
            type: String,
            enum: Object.values(SUBSCRIPTION_STATUS),
            default: SUBSCRIPTION_STATUS.ACTIVE,
        },
        amountPaid: {
            type: Number,
            required: true,
        },
        transactionId: {
            type: String,
        }
    },
    { timestamps: true }
);

module.exports = subscriptionSchema;
