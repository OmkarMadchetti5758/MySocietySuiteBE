"use strict";

const AppError = require("../common/AppError");
const env = require("../config/env");
const { logger } = require("./logger");

const handleCastErrorDB = err => {
    const message = `Invalid ${err.path}: ${err.value}.`;
    return new AppError(message, 400);
};

const handleDuplicateFieldsDB = err => {
    let message = "A record with this information already exists.";
    const errmsg = err.errmsg || err.message || "";
    const match = errmsg.match(/(["'])(\\?.)*?\1/);
    if (match && match[0]) {
        message = `Duplicate entry: ${match[0]}. This transaction or record has already been created.`;
    } else if (err.keyValue) {
        const keys = Object.keys(err.keyValue).join(", ");
        message = `Duplicate entry for ${keys}. Record already exists.`;
    }
    return new AppError(message, 400);
};

const handleValidationErrorDB = err => {
    const errors = Object.values(err.errors).map(el => el.message);
    const message = `Invalid input data. ${errors.join(". ")}`;
    return new AppError(message, 400);
};

const handleJWTError = () => new AppError("Invalid token. Please log in again!", 401);

const handleJWTExpiredError = () => new AppError("Your token has expired! Please log in again.", 401);

const sendErrorDev = (err, res) => {
    res.status(err.statusCode).json({
        status: err.status,
        error: err,
        message: err.message,
        stack: err.stack
    });
};

const sendErrorProd = (err, res) => {
    // Operational, trusted error: send message to client
    if (err.isOperational) {
        const body = {
            status: err.status,
            message: err.message,
        };
        if (err.errorCode) {
            body.errorCode = err.errorCode;
        }
        res.status(err.statusCode).json(body);
    }
    // Programming or other unknown error: don't leak error details
    else {
        // 1) Log error
        logger.error("ERROR 💥", err);

        // 2) Send generic message
        res.status(500).json({
            status: "error",
            message: "Something went very wrong!"
        });
    }
};

module.exports = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || "error";

    // Normalize known database errors into clean operational AppErrors
    let error = { ...err };
    error.message = err.message;
    error.name = err.name;
    error.code = err.code;

    if (error.name === "CastError") error = handleCastErrorDB(error);
    if (error.code === 11000) error = handleDuplicateFieldsDB(error);
    if (error.name === "ValidationError") error = handleValidationErrorDB(error);
    if (error.name === "JsonWebTokenError") error = handleJWTError();
    if (error.name === "TokenExpiredError") error = handleJWTExpiredError();

    if (env.NODE_ENV === "development") {
        sendErrorDev(error, res);
    } else {
        sendErrorProd(error, res);
    }
};