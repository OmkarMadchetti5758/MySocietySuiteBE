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
        registrationNumber: {
            type: String,
            unique: true,
            sparse: true,
            trim: true,
        },
        logo: {
            type: String,
        },
        societyType: {
            type: String,
            enum: ["Residential", "Commercial", "Mixed"],
        },
        numberOfBlocks: {
            type: Number,
            default: 0,
        },
        blocks: [{
            type: String,
            trim: true,
        }],
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
            default: SOCIETY_STATUS.ACTIVE,
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
            required: false,
            lowercase: true,
            trim: true,
        },
        contactPhone: {
            type: String,
            required: false,
            trim: true,
        },
        permissionsVersion: {
            type: Number,
            default: 1,
            // Incremented every time a role's permissions are changed for this society.
            // Embedded in JWT at login; middleware compares it on each request.
            // Mismatch signals the FE to re-fetch the permissions matrix without forcing re-login.
        },
    },
    { timestamps: true }
);

// At least one contact method must be present
societySchema.pre("validate", async function () {
    if (!this.contactEmail && !this.contactPhone) {
        throw new Error("At least one of contactEmail or contactPhone is required.");
    }
});

module.exports = societySchema;
