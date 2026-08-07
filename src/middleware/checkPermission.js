"use strict";

const AppError = require("../common/AppError");
const { getRolePermissions, PERMISSION_LEVELS } = require("../common/constants");

/**
 * Factory middleware for Role-Based Access Control (RBAC).
 * 
 * @param {string} moduleName - The module from MODULES (e.g., MODULES.BILLING_ACCOUNTS)
 * @param {number} requiredLevel - The required permission level (e.g., PERMISSION_LEVELS.VIEW)
 * @returns {Function} Express middleware
 */
const checkPermission = (moduleName, requiredLevel = PERMISSION_LEVELS.VIEW) => {
    return (req, res, next) => {
        if (!req.user || !req.user.role) {
            return next(new AppError("Not authorized. Role missing.", 403));
        }

        const permissions = getRolePermissions(req.user.role);
        
        if (!permissions) {
            return next(new AppError(`Access denied. Invalid or unknown role: ${req.user.role}`, 403));
        }

        const modulePerm = permissions[moduleName];

        if (!modulePerm || modulePerm.level < requiredLevel) {
            return next(new AppError(`Access denied for module: ${moduleName}. Insufficient permissions.`, 403));
        }

        // Attach permission scope and level for use in controllers (e.g., filtering queries by 'own')
        req.permission = {
            level: modulePerm.level,
            scope: modulePerm.scope
        };

        next();
    };
};

module.exports = checkPermission;
