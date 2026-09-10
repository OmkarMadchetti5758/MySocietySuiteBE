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

            const isPermitted = hasBillingPermission(req.user, permissionKey);

            if (!isPermitted) {
                // Log denied attempt for sensitive operations
                await logBillingAction({
                    req,
                    action: permissionKey,
                    resource: permissionKey.split(".")[1] || "BILLING",
                    status: "DENIED",
                    details: { reason: "Missing required billing permission" },
                });

                return next(new AppError(`Access denied. Insufficient permission for ${permissionKey}`, 403));
            }

            req.billingPermission = permissionKey;
            next();
        } catch (error) {
            next(error);
        }
    };
};

module.exports = {
    requireBillingPermission,
};
