"use strict";

const AppError = require("../common/AppError");
const { getMasterConnection } = require("../config/masterDb");

/**
 * Middleware to resolve tenant context for public routes
 * (e.g. login, society selection dropdown) where the user
 * does not yet have a JWT but needs to identify their society.
 *
 * After migration: resolves only `societyId` — the `x-database-name`
 * header is no longer used (per-tenant DBs are retired).
 *
 * Accepts:
 *   - x-tenant-id: the MongoDB ObjectId of the society
 *
 * Attaches: req.tenantInfo = { societyId }
 */
const tenantResolver = async (req, res, next) => {
    try {
        const tenantId = req.headers["x-tenant-id"];

        if (!tenantId) {
            // No tenant context provided — continue, routes may not require it
            return next();
        }

        const masterDb = getMasterConnection();
        const Society = masterDb.model("Society");

        const society = await Society.findById(tenantId).lean();
        if (!society) {
            return next(new AppError("Society not found.", 404));
        }

        if (society.status !== "active") {
            return next(new AppError("This society account is not active.", 403));
        }

        req.tenantInfo = {
            societyId: society._id,
        };

        return next();
    } catch (error) {
        next(error);
    }
};

module.exports = tenantResolver;
