"use strict";

const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { getTenantConnection } = require("../config/tenantDb");
const { getMasterConnection } = require("../config/masterDb");
const AppError = require("../common/AppError");
const { TOKEN_TYPE } = require("../common/constants");

/**
 * Middleware to authenticate user via JWT and attach user info and tenant DB to request.
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

        req.user = {
            id: decoded.id,
            role: decoded.role,
            societyId: decoded.societyId,
            databaseName: decoded.databaseName,
        };

        // Attach tenant DB if applicable
        if (decoded.databaseName) {
            try {
                req.tenantDb = await getTenantConnection(decoded.databaseName);
            } catch (dbError) {
                return next(new AppError("Failed to connect to tenant database.", 500));
            }
        }

        next();
    } catch (error) {
        next(error);
    }
};

module.exports = authenticate;
