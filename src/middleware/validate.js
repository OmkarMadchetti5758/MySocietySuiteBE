"use strict";

const { validationResult } = require("express-validator");
const AppError = require("../common/AppError");

/**
 * Middleware to format express-validator errors.
 */
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const extractedErrors = [];
        errors.array().forEach(err => extractedErrors.push({ [err.path]: err.msg }));

        return res.status(400).json({
            status: "fail",
            message: "Validation Error",
            errors: extractedErrors
        });
    }
    next();
};

module.exports = validate;
