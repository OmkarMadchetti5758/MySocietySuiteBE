"use strict";

/**
 * Standard API Success Response
 */
const sendSuccess = (res, statusCode, message, data = {}) => {
    return res.status(statusCode).json({
        status: "success",
        message,
        data,
    });
};

/**
 * Standard API Error Response (mostly handled by errorHandler, but useful for custom exits)
 */
const sendError = (res, statusCode, message, errorCode = null) => {
    return res.status(statusCode).json({
        status: "fail",
        message,
        ...(errorCode && { errorCode }),
    });
};

/**
 * Standard API Paginated Response
 */
const sendPaginated = (res, statusCode, message, data, meta) => {
    return res.status(statusCode).json({
        status: "success",
        message,
        data,
        meta,
    });
};

module.exports = {
    sendSuccess,
    sendError,
    sendPaginated,
};
