"use strict";

const env = require("../config/env");

const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

const generateOTPExpiry = () => {
    const expires = new Date();
    expires.setMinutes(expires.getMinutes() + env.OTP_EXPIRES_IN_MINUTES);
    return expires;
};

module.exports = { generateOTP, generateOTPExpiry };
