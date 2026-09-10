"use strict";

const express    = require("express");
const OtpService = require("./otp.service");
const { sendSuccess, sendError } = require("../../utils/response.utils");

const router = express.Router();


router.post("/send", async (req, res, next) => {
    try {
        const { identifier, purpose, societyId } = req.body;
        if (!identifier || !purpose || !societyId) {
            return sendError(res, 400, "identifier, purpose, and societyId are required");
        }
        const result = await OtpService.sendOtp(identifier, purpose, societyId);
        return sendSuccess(res, 200, result.message);
    } catch (err) {
        next(err);
    }
});

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
