"use strict";

const mongoose = require("mongoose");
const crypto = require("crypto");

const inviteTokenSchema = new mongoose.Schema(
    {
        tokenHash: {
            type: String,
            required: true,
            unique: true,
        },
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            ref: "Society",
        },
        adminId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            // References a User document in the operations DB
        },
        purpose: {
            type: String,
            enum: ["society_admin", "resident", "manager", "staff"],
            default: "resident",
            // Tells the onboarding page which flow to render
        },
        expiresAt: {
            type: Date,
            required: true,
        },
        used: {
            type: Boolean,
            default: false,
        },
        // ── Partial-completion tracking (manager invites only) ─────────────────
        // Allows the user to resume after OTP without re-verifying within
        // the token's validity window.
        otpEmailVerified: {
            type: Boolean,
            default: false,
        },
        otpPhoneVerified: {
            type: Boolean,
            default: false,
        },
    },
    { timestamps: true }
);

// TTL index to automatically remove expired tokens after a week
inviteTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 604800 });

// Static method to generate and hash token
inviteTokenSchema.statics.generateToken = function() {
    const plainToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(plainToken).digest("hex");
    return { plainToken, tokenHash };
};

// Static method to hash a received token for comparison
inviteTokenSchema.statics.hashToken = function(plainToken) {
    return crypto.createHash("sha256").update(plainToken).digest("hex");
};

module.exports = inviteTokenSchema;
