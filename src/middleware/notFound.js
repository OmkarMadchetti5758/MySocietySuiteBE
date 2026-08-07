"use strict";

const AppError = require("../common/AppError");

const notFound = (req, res, next) => {
    next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
};

module.exports = notFound;