"use strict";

const AppError = require("../common/AppError");
const { userHasAnyRole } = require("../common/permissionResolver");

const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !req.user.role) {
            return next(new AppError("Not authorized. Role missing.", 403));
        }

        if (!userHasAnyRole(req.user, roles)) {
            return next(new AppError(`Access denied. Requires role: ${roles.join(" or ")}`, 403));
        }

        next();
    };
};

module.exports = authorize;
