"use strict";

const express    = require("express");
const OtpService = require("./otp.service");
const { sendSuccess, sendError } = require("../../utils/response.utils");

const router = express.Router();

/**
 * OTP Routes — /api/v1/otp
 *
 * These routes are NOT protected by authenticate middleware because
 * the user is mid-onboarding and doesn't have a session yet.
 * Rate limiting is enforced within OtpService itself.
 */

/**
 * @route  POST /api/v1/otp/send
 * @desc   Send (or resend) an OTP to the given identifier
 * @body   { identifier: string, purpose: string, societyId: string }
 */
router.post("/send", async (req, res, next) => {
    try {
        const { identifier, purpose, societyId } = req.body;
        if (!identifier || !purpose || !societyId) {
            return sendError(res, 400, "identifier, purpose, and societyId are required");
        }
        const result = await OtpService.sendOtp(identifier, purpose, societyId);
        return sendSuccess(res, 200, result.message, {
            ...(result.devOtpCode ? { devOtpCode: result.devOtpCode } : {})
        });
    } catch (err) {
        next(err);
    }
});

/**
 * @route  POST /api/v1/otp/verify
 * @desc   Verify an OTP code
 * @body   { identifier: string, code: string, purpose: string, societyId: string }
 */
router.post("/verify", async (req, res, next) => {
    try {
        const { identifier, code, purpose, societyId } = req.body;
        if (!identifier || !code || !purpose || !societyId) {
            return sendError(res, 400, "identifier, code, purpose, and societyId are required");
        }
        const result = await OtpService.verifyOtp(identifier, code, purpose, societyId);
        return sendSuccess(res, 200, "OTP verified successfully", result);
    } catch (err) {
        next(err);
    }
});

/**
 * @route  GET /api/v1/otp/status
 * @desc   Check if an identifier already has a verified OTP (for flow-resume)
 * @query  identifier, purpose, societyId
 */
router.get("/status", async (req, res, next) => {
    try {
        const { identifier, purpose, societyId } = req.query;
        if (!identifier || !purpose || !societyId) {
            return sendError(res, 400, "identifier, purpose, and societyId are required");
        }
        const verified = await OtpService.isAlreadyVerified(identifier, purpose, societyId);
        return sendSuccess(res, 200, "OTP status retrieved", { verified });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
