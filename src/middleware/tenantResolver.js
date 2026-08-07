"use strict";

const AppError = require("../common/AppError");
const { getMasterConnection } = require("../config/masterDb");

/**
 * Middleware to resolve tenant from headers (e.g., for login or onboarding routes
 * where the user doesn't have a JWT yet, but provides a society context).
 * Usually looks for 'x-tenant-id' or 'x-database-name'.
 */
const tenantResolver = async (req, res, next) => {
    try {
        const tenantId = req.headers["x-tenant-id"];
        const databaseName = req.headers["x-database-name"];

        if (databaseName) {
            req.tenantInfo = { databaseName };
            return next();
        }

        if (tenantId) {
            const masterDb = getMasterConnection();
            const SocietyModel = masterDb.model("Society"); // Ensure model is registered

            const society = await SocietyModel.findById(tenantId);
            if (!society || !society.databaseName) {
                return next(new AppError("Tenant not found.", 404));
            }
            req.tenantInfo = {
                societyId: society._id,
                databaseName: society.databaseName
            };
            return next();
        }

        // If neither is provided, continue. Handlers can check req.tenantInfo if it's required.
        next();
    } catch (error) {
        next(error);
    }
};

module.exports = tenantResolver;
