"use strict";

const AppError = require("../../common/AppError");
const { getMasterConnection } = require("../../config/masterDb");

const MAX_ATTEMPTS     = 5;
const MAX_RESENDS      = 3;
const RESEND_COOLDOWN_SECONDS = 30;
const RATE_WINDOW_HOURS = 1;
const OTP_TTL_MINUTES   = 10;
const LOCKOUT_MINUTES   = 20;

class OtpService {
    _getModel() {
        const masterDb = getMasterConnection();
        return masterDb.model("Otp");
    }

    /**
     * Generate and store an OTP for a given identifier + purpose.
     * Enforces rate limiting (max 3 resends/hour, 30s cooldown between resends).
     *
     * @param {string} identifier - email or phone
     * @param {string} purpose    - "manager_invite"
     * @param {string} societyId
     * @returns {{ otp: string }} — In production this would be sent via email/SMS.
     *                              In dev, we log it to the console.
     */
    async sendOtp(identifier, purpose, societyId) {
        const Otp = this._getModel();
        const normalizedIdentifier = identifier.toLowerCase().trim();
        const now = new Date();

        // Check for existing active OTP doc for this identifier + purpose
        const existing = await Otp.findOne({
            identifier: normalizedIdentifier,
            purpose,
            societyId,
        }).select("+codeHash");

        if (existing) {
            // Cooldown check: must wait 30s between resends
            const secondsSinceLastResend = existing.lastResendAt
                ? (now - existing.lastResendAt) / 1000
                : Infinity;
            if (secondsSinceLastResend < RESEND_COOLDOWN_SECONDS) {
                const waitSeconds = Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSinceLastResend);
                throw new AppError(
                    `Please wait ${waitSeconds}s before requesting another OTP.`,
                    429,
                    "OTP_COOLDOWN"
                );
            }

            // Rate limit: max 3 resends per hour
            const hoursSinceFirst = (now - existing.createdAt) / 3600000;
            if (hoursSinceFirst < RATE_WINDOW_HOURS && existing.resendCount >= MAX_RESENDS) {
                throw new AppError(
                    "Maximum OTP resend attempts reached. Please contact the Society Admin to resend your invite.",
                    429,
                    "OTP_RATE_LIMITED"
                );
            }

            // Generate new code and update the existing doc
            const { code, codeHash } = Otp.schema.statics.generateCode.call(Otp);
            const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000);

            existing.codeHash     = codeHash;
            existing.expiresAt    = expiresAt;
            existing.attempts     = 0;
            existing.verified     = false;
            existing.rateLockUntil = null;
            existing.resendCount  = (existing.resendCount || 1) + 1;
            existing.lastResendAt = now;
            await existing.save();

            this._logOtp(normalizedIdentifier, code, purpose);
            return { 
                message: "OTP resent successfully",
                ...(process.env.NODE_ENV === "development" ? { devOtpCode: code } : {})
            };
        }

        // First-time: create new OTP doc
        const { code, codeHash } = Otp.schema.statics.generateCode.call(Otp);
        const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000);

        await Otp.create({
            identifier: normalizedIdentifier,
            purpose,
            societyId,
            codeHash,
            expiresAt,
            resendCount: 1,
            lastResendAt: now,
        });

        this._logOtp(normalizedIdentifier, code, purpose);
        return { 
            message: "OTP sent successfully",
            ...(process.env.NODE_ENV === "development" ? { devOtpCode: code } : {})
        };
    }

    /**
     * Verify an OTP code for an identifier + purpose.
     * Increments attempts on failure, locks after MAX_ATTEMPTS.
     *
     * @param {string} identifier
     * @param {string} code       - plain 6-digit code from user
     * @param {string} purpose
     * @param {string} societyId
     * @returns {{ verified: true }}
     */
    async verifyOtp(identifier, code, purpose, societyId) {
        const Otp = this._getModel();
        const normalizedIdentifier = identifier.toLowerCase().trim();
        const now = new Date();

        const otpDoc = await Otp.findOne({
            identifier: normalizedIdentifier,
            purpose,
            societyId,
        }).select("+codeHash");

        if (!otpDoc) {
            throw new AppError("No OTP found. Please request a new one.", 400, "OTP_NOT_FOUND");
        }

        // Check lockout
        if (otpDoc.rateLockUntil && otpDoc.rateLockUntil > now) {
            const minLeft = Math.ceil((otpDoc.rateLockUntil - now) / 60000);
            throw new AppError(
                `Too many failed attempts. Try again in ${minLeft} minute(s).`,
                429,
                "OTP_LOCKED"
            );
        }

        // Check expiry
        if (otpDoc.expiresAt < now) {
            throw new AppError("OTP has expired. Please request a new one.", 400, "OTP_EXPIRED");
        }

        // Already verified — idempotent response
        if (otpDoc.verified) {
            return { verified: true, alreadyVerified: true };
        }

        // Check code
        const hashCode = Otp.schema.statics.hashCode.call(Otp, code);
        if (hashCode !== otpDoc.codeHash) {
            otpDoc.attempts += 1;
            if (otpDoc.attempts >= MAX_ATTEMPTS) {
                otpDoc.rateLockUntil = new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000);
            }
            await otpDoc.save();

            const remaining = MAX_ATTEMPTS - otpDoc.attempts;
            if (remaining <= 0) {
                throw new AppError(
                    `Maximum attempts reached. Please wait ${LOCKOUT_MINUTES} minutes before trying again.`,
                    429,
                    "OTP_LOCKED"
                );
            }
            throw new AppError(
                `Incorrect OTP. ${remaining} attempt(s) remaining.`,
                400,
                "OTP_INCORRECT"
            );
        }

        // Correct code — mark as verified
        otpDoc.verified  = true;
        otpDoc.attempts  = 0;
        otpDoc.rateLockUntil = null;
        await otpDoc.save();

        return { verified: true };
    }

    /**
     * Check whether an identifier has an already-verified OTP for this purpose.
     * Used to skip re-verification when resuming an abandoned manager onboarding.
     */
    async isAlreadyVerified(identifier, purpose, societyId) {
        const Otp = this._getModel();
        const doc = await Otp.findOne({
            identifier: identifier.toLowerCase().trim(),
            purpose,
            societyId,
            verified: true,
            expiresAt: { $gt: new Date() }, // Check it's not expired
        }).lean();
        return !!doc;
    }

    /**
     * Invalidate all OTP records for an identifier (called when invite is cancelled/resent).
     */
    async invalidateAll(identifier, purpose, societyId) {
        const Otp = this._getModel();
        await Otp.deleteMany({
            identifier: identifier.toLowerCase().trim(),
            purpose,
            societyId,
        });
    }

    // ── Private Helpers ────────────────────────────────────────────────────────

    _logOtp(identifier, code, purpose) {
        console.log("\n=============================================");
        console.log("=== DEV OTP ===");
        console.log(`Identifier: ${identifier}`);
        console.log(`Purpose:    ${purpose}`);
        console.log(`OTP Code:   ${code}   (expires in ${OTP_TTL_MINUTES} min)`);
        console.log("=============================================\n");
    }
}

module.exports = new OtpService();
