"use strict";

require("dotenv").config();

/**
 * Validates that required environment variables are present.
 * Throws an error at startup if any are missing.
 */
const required = [
    "MONGODB_URI",
    "MASTER_DB_NAME",
    "JWT_SECRET",
    "JWT_REFRESH_SECRET",
    "JWT_ACCESS_EXPIRES_IN",
    "JWT_REFRESH_EXPIRES_IN",
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
    throw new Error(
        `❌ Missing required environment variables: ${missing.join(", ")}\n` +
        `   Please check your .env file.`
    );
}

module.exports = {
    // Server
    PORT: parseInt(process.env.PORT, 10) || 5000,
    NODE_ENV: process.env.NODE_ENV || "development",

    // Database
    MONGODB_URI: process.env.MONGODB_URI,
    MASTER_DB_NAME: process.env.MASTER_DB_NAME || "mysociety_master",

    // JWT
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
    JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || "7d",

    // CORS
    FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:5173",

    // SMTP
    SMTP_HOST: process.env.SMTP_HOST || "smtp.gmail.com",
    SMTP_PORT: parseInt(process.env.SMTP_PORT, 10) || 587,
    SMTP_SECURE: process.env.SMTP_SECURE === "true",
    SMTP_USER: process.env.SMTP_USER || "",
    SMTP_PASS: process.env.SMTP_PASS || "",

    // OTP
    OTP_EXPIRES_IN_MINUTES: parseInt(process.env.OTP_EXPIRES_IN_MINUTES, 10) || 10,

    // Rate Limiting
    RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
    AUTH_RATE_LIMIT_MAX: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 10,
};