"use strict";

/**
 * AppError — Custom operational error class.
 *
 * All intentional, user-facing errors should use this class.
 * Non-operational errors (bugs, DB crashes) should be plain Error objects.
 *
 * @param {string} message - Human-readable error message
 * @param {number} statusCode - HTTP status code
 * @param {string} [errorCode] - Optional machine-readable error code
 */
class AppError extends Error {
    constructor(message, statusCode, errorCode = null) {
        super(message);

        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
        this.isOperational = true;
        this.errorCode = errorCode;

        // Capture stack trace, excluding AppError constructor from trace
        Error.captureStackTrace(this, this.constructor);
    }
}

module.exports = AppError;
