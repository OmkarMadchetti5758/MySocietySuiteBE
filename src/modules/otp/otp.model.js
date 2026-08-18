"use strict";

const mongoose = require("mongoose");
const crypto   = require("crypto");

/**
 * OTP — Master DB
 *
 * Stores hashed one-time passwords for identity verification.
 * Currently used for the manager invite onboarding flow.
 *
 * Rate-limiting fields:
 *   - resendCount: number of OTPs sent in the current rate window
 *   - lastResendAt: timestamp of last resend (for 30s cooldown check)
 *
 * Design choices:
 *   - Code is stored hashed (SHA-256) — never plaintext
 *   - TTL index on expiresAt auto-removes expired docs
 *   - attempts is incremented on every failed verify call (max: 5)
 *   - verified: true once user enters correct code; allows resuming flow
 *     without re-verifying within the invite token's validity window
 */
const otpSchema = new mongoose.Schema(
    {
        identifier: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
            // Email or phone number of the recipient
        },
        purpose: {
            type: String,
            required: true,
            enum: ["manager_invite", "resident_invite"],
            // Scopes OTPs so the same identifier can have OTPs for different flows
        },
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        codeHash: {
            type: String,
            required: true,
            select: false, // Never return the hash to the client
        },
        expiresAt: {
            type: Date,
            required: true,
            // 10-minute window — set in service layer
        },
        attempts: {
            type: Number,
            default: 0,
            // Incremented on each failed verify; locked out at MAX_ATTEMPTS (5)
        },
        verified: {
            type: Boolean,
            default: false,
            // Set to true on successful verification — allows resuming flow
        },

        // ── Rate Limiting ──────────────────────────────────────────────────────
        resendCount: {
            type: Number,
            default: 1,
            // Number of OTPs sent (max 3 per RATE_WINDOW_HOURS hours)
        },
        lastResendAt: {
            type: Date,
            default: Date.now,
        },
        rateLockUntil: {
            type: Date,
            default: null,
            // Non-null when user is locked out after exceeding max attempts
        },
    },
    { timestamps: true }
);

// TTL: auto-remove docs 1 hour after expiry to give leeway for debugging
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

// Fast lookup by (identifier, purpose, societyId) — the primary query pattern
otpSchema.index({ identifier: 1, purpose: 1, societyId: 1 });

// ── Static Helpers ─────────────────────────────────────────────────────────────
otpSchema.statics.generateCode = function () {
    // Cryptographically random 6-digit OTP
    const code = String(crypto.randomInt(100000, 999999));
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    return { code, codeHash };
};

otpSchema.statics.hashCode = function (code) {
    return crypto.createHash("sha256").update(String(code)).digest("hex");
};

module.exports = otpSchema;
