"use strict";

const mongoose = require("mongoose");
const { SOCIETY_STATUS } = require("../../common/constants");

const societySchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, "Society name is required"],
            trim: true,
        },
        databaseName: {
            type: String,
            required: [true, "Database name is required"],
            unique: true,
            lowercase: true,
            trim: true,
        },
        address: {
            street: String,
            city: String,
            state: String,
            zipCode: String,
            country: { type: String, default: "India" },
        },
        status: {
            type: String,
            enum: Object.values(SOCIETY_STATUS),
            default: SOCIETY_STATUS.TRIAL,
        },
        subscriptionPlanId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SubscriptionPlan",
        },
        adminId: {
            type: mongoose.Schema.Types.ObjectId, // Reference to User in tenant DB, mostly for informational purpose
        },
        contactEmail: {
            type: String,
            required: true,
            lowercase: true,
        },
        contactPhone: {
            type: String,
            required: true,
        }
    },
    { timestamps: true }
);

module.exports = societySchema;
