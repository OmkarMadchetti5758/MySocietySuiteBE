"use strict";

const sendSuccess = (res, statusCode, message, data = {}) => {
    return res.status(statusCode).json({
        status: "success",
        message,
        data,
    });
};

const sendError = (res, statusCode, message, errorCode = null) => {
    return res.status(statusCode).json({
        status: "fail",
        message,
        ...(errorCode && { errorCode }),
    });
};

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
