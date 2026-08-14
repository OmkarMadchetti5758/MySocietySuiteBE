"use strict";

const AppError = require("../common/AppError");
const { userHasAnyRole } = require("../common/permissionResolver");

/**
 * Middleware to restrict access to specific roles.
 * Must be used AFTER the authenticate middleware.
 *
 * Supports dual-role users via UserSocietyMapping.roleKeys[].
 *
 * @param {...string} roles - Allowed roles
 * @returns {Function} Express middleware function
 */
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
