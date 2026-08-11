"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const AuthController = require("./auth.controller");
const validate = require("../../middleware/validate");
const { loginValidation, refreshTokenValidation } = require("./auth.validation");
const authenticate = require("../../middleware/authenticate");
const tenantResolver = require("../../middleware/tenantResolver");
const env = require("../../config/env");

const router = express.Router();

// Rate limiting for auth routes to prevent brute force
const authLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.AUTH_RATE_LIMIT_MAX,
    message: {
        status: "fail",
        message: "Too many login attempts from this IP, please try again later."
    }
});

router.post(
    "/login",
    authLimiter,
    tenantResolver,
    loginValidation,
    validate,
    AuthController.login
);

router.post(
    "/super-admin/login",
    authLimiter,
    // Add validation if needed, or re-use loginValidation if it fits. 
    // loginValidation likely requires identifier/password.
    AuthController.superAdminLogin
);

router.post(
    "/refresh-token",
    refreshTokenValidation,
    validate,
    AuthController.refreshToken
);

// Protected Routes
router.use(authenticate);

router.post("/logout", AuthController.logout);
router.get("/me", AuthController.getMe);

module.exports = router;
