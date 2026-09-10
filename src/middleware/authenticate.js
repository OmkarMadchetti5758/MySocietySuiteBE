"use strict";

const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { getOperationsConnection } = require("../config/operationsDb");
const { getMasterConnection } = require("../config/masterDb");
const AppError = require("../common/AppError");
const { TOKEN_TYPE } = require("../common/constants");
const { resolveRoleKey } = require("../common/permissionResolver");

const { getSocietyPermissionsVersion, bustPermissionsVersionCache } = require("../common/permissionsVersionCache");

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

        // Attach user context from JWT
        req.user = {
            id: decoded.id,
            role: decoded.role,
            societyId: decoded.societyId,
            permissionsVersion: decoded.permissionsVersion ?? 1,
        };

        req.opsDb = getOperationsConnection();

        if (decoded.societyId && decoded.role !== "super_admin") {
            const masterDb = getMasterConnection();
            const Mapping = masterDb.model("UserSocietyMapping");
            const mapping = await Mapping.findOne({
                userId: decoded.id,
                societyId: decoded.societyId,
            }).lean();

            if (mapping && mapping.status === "deactivated") {
                return next(new AppError("Your account has been deactivated for this society.", 403, "ACCOUNT_DEACTIVATED"));
            }

            req.user.roleKeys = mapping?.roleKeys?.length
                ? [...new Set(mapping.roleKeys.map(resolveRoleKey))]
                : mapping?.role
                    ? [resolveRoleKey(mapping.role)]
                    : [resolveRoleKey(decoded.role)];
            req.user.flatId = mapping?.flatId || null;

            try {
                const currentVersion = await getSocietyPermissionsVersion(decoded.societyId);
                if (currentVersion !== (decoded.permissionsVersion ?? 1)) {
                    res.setHeader("X-Permissions-Stale", "true");
                }
            } catch (_) {
            }
        }

        next();
    } catch (error) {
        next(error);
    }
};

module.exports = authenticate;
module.exports.bustPermissionsVersionCache = bustPermissionsVersionCache;
