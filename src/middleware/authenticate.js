"use strict";

const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { getOperationsConnection } = require("../config/operationsDb");
const AppError = require("../common/AppError");
const { TOKEN_TYPE } = require("../common/constants");

/**
 * Middleware to authenticate a user via JWT and attach context to the request.
 *
 * After migration to the shared-collection model, this middleware:
 *   - Decodes the JWT to get { id, role, societyId }
 *   - Attaches req.user = { id, role, societyId }
 *   - Attaches req.opsDb = the single shared operations DB connection
 *
 * It no longer resolves a per-tenant database or attaches req.tenantDb.
 * All repositories use req.opsDb (or call getOperationsConnection() directly).
 */
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return next(new AppError("Access denied. No token provided.", 401));
        }

        const token = authHeader.split(" ")[1];

        if (!token) {
            return next(new AppError("Access denied. Token missing.", 401));
        }

        let decoded;
        try {
            decoded = jwt.verify(token, env.JWT_SECRET);
        } catch (err) {
            if (err.name === "TokenExpiredError") {
                return next(new AppError("Access token expired. Please refresh.", 401, "TOKEN_EXPIRED"));
            }
            return next(new AppError("Invalid access token.", 401, "TOKEN_INVALID"));
        }

        if (decoded.type !== TOKEN_TYPE.ACCESS) {
            return next(new AppError("Invalid token type.", 401, "INVALID_TOKEN_TYPE"));
        }

        // Attach user context from JWT — societyId replaces databaseName
        req.user = {
            id:        decoded.id,
            role:      decoded.role,
            societyId: decoded.societyId, // ObjectId string
        };

        // Attach the single shared operations DB connection
        // All downstream repositories use this instead of a per-tenant connection
        req.opsDb = getOperationsConnection();

        next();
    } catch (error) {
        next(error);
    }
};

module.exports = authenticate;
