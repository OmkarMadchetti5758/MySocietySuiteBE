"use strict";

const env = require("../config/env");

/**
 * Generate a random 6-digit OTP
 */
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Generate OTP expiry date based on config
 */
const generateOTPExpiry = () => {
    const expires = new Date();
    expires.setMinutes(expires.getMinutes() + env.OTP_EXPIRES_IN_MINUTES);
    return expires;
};

module.exports = { generateOTP, generateOTPExpiry };
