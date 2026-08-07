"use strict";

const { body } = require("express-validator");

const loginValidation = [
    body("identifier")
        .notEmpty()
        .withMessage("Identifier (email or mobile) is required")
        .trim(),
    body("password")
        .notEmpty()
        .withMessage("Password is required"),
];

const refreshTokenValidation = [
    body("refreshToken")
        .notEmpty()
        .withMessage("Refresh token is required"),
];

module.exports = {
    loginValidation,
    refreshTokenValidation,
};
