"use strict";

const AppError = require("../common/AppError");
const { hasBillingPermission } = require("../services/billingAuthorization.service");
const { logBillingAction } = require("../services/billingAudit.service");

const requireBillingPermission = (permissionKey) => {
    return async (req, res, next) => {
        try {
            if (!req.user || !req.user.role) {
                return next(new AppError("Unauthenticated. Token missing or invalid.", 401));
            }

            const keys = Array.isArray(permissionKey) ? permissionKey : [permissionKey];
            const isPermitted = keys.some(pk => hasBillingPermission(req.user, pk));

            if (!isPermitted) {
                // Log denied attempt for sensitive operations
                await logBillingAction({
                    req,
                    action: keys[0],
                    resource: keys[0].split(".")[1] || "BILLING",
                    status: "DENIED",
                    details: { reason: `Missing required billing permission: ${keys.join(", ")}` },
                });

                return next(new AppError(`Access denied. Insufficient permission for ${keys.join(", ")}`, 403));
            }

            req.billingPermission = keys.find(pk => hasBillingPermission(req.user, pk));
            next();
        } catch (error) {
            next(error);
        }
    };
};

module.exports = {
    requireBillingPermission,
};
