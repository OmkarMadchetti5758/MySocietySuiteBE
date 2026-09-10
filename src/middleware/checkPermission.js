"use strict";

const AppError = require("../common/AppError");
const { PERMISSION_LEVELS } = require("../common/constants");
const {
    resolveEffectivePermissionsForRoles,
    resolveRoleKey,
} = require("../common/permissionResolver");

/**
 * Factory middleware for Role-Based Access Control (RBAC).
 *
 * @param {string} moduleName - The module from MODULES (e.g., MODULES.BILLING_ACCOUNTS)
 * @param {number} requiredLevel - The required permission level (e.g., PERMISSION_LEVELS.VIEW)
 * @returns {Function} Express middleware
 */
const checkPermission = (moduleName, requiredLevel = PERMISSION_LEVELS.VIEW) => {
    return async (req, res, next) => {
        try {
            if (!req.user || !req.user.role) {
                return next(new AppError("Not authorized. Role missing.", 403));
            }

            const roleKeys = req.user.roleKeys?.length
                ? req.user.roleKeys
                : [resolveRoleKey(req.user.role)];

            const permissions = await resolveEffectivePermissionsForRoles(
                req.user.societyId,
                roleKeys,
                req.user.role
            );

            if (!permissions) {
                return next(new AppError(`Access denied. Invalid or unknown role: ${req.user.role}`, 403));
            }

            const modules = Array.isArray(moduleName) ? moduleName : [moduleName];
            let allowedPerm = null;

            for (const mod of modules) {
                const modulePerm = permissions[mod];
                if (modulePerm && modulePerm.level >= requiredLevel) {
                    allowedPerm = modulePerm;
                    break;
                }
            }

            if (!allowedPerm) {
                console.error(`[RBAC DENIED] User role=${req.user?.role}, roleKeys=${JSON.stringify(req.user?.roleKeys)}, societyId=${req.user?.societyId}, modules=${modules.join(",")}, reqLevel=${requiredLevel}`);
                return next(new AppError(`Access denied for module: ${modules.join(" or ")}. Insufficient permissions.`, 403));
            }

            req.permission = {
                level: allowedPerm.level,
                scope: allowedPerm.scope,
            };

            next();
        } catch (error) {
            next(error);
        }
    };
};

module.exports = checkPermission;
