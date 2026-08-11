"use strict";

const AuthRepository = require("./auth.repository");
const AppError = require("../../common/AppError");
const { AUTH_ERRORS } = require("./auth.constants");
const { generateAccessToken, generateRefreshToken, verifyToken } = require("../../utils/jwt.utils");
const { getRolePermissions } = require("../../common/constants");

/**
 * AuthService
 *
 * After migration to the shared-collection model:
 *   - Login no longer needs `databaseName` — it uses `societyId` instead
 *   - All tokens carry `societyId` in the payload (not `databaseName`)
 *   - No getTenantConnection() calls anywhere in this service
 *
 * Login flow:
 *   1. Look up identifier in UserSocietyMapping (master DB) → get societyId(s)
 *   2. If the client provides an explicit societyId (e.g. multi-society user), use that
 *   3. Verify the resolved society is active
 *   4. Find the user in ops DB scoped by societyId + identifier
 *   5. Verify password → generate tokens
 */
class AuthService {
    /**
     * @param {string} identifier   — email or mobile
     * @param {string} password
     * @param {string} [societyIdHeader] — ObjectId string from x-tenant-id header (optional override for multi-society users)
     */
    async login(identifier, password, societyIdHeader) {
        // 1. Resolve societyId
        let societyId;

        if (societyIdHeader) {
            // Client has explicitly identified the society (e.g. dropdown, subdomain)
            const society = await AuthRepository.getSocietyById(societyIdHeader);
            if (!society) {
                throw new AppError(AUTH_ERRORS.SOCIETY_NOT_FOUND, 404);
            }
            societyId = society._id;
        } else {
            // Auto-resolve from UserSocietyMapping
            const mappings = await AuthRepository.getMappingsForIdentifier(identifier);
            if (!mappings || mappings.length === 0) {
                throw new AppError(AUTH_ERRORS.SOCIETY_NOT_FOUND, 404);
            }

            if (mappings.length > 1) {
                // User belongs to multiple societies — client MUST specify which one
                throw new AppError(
                    "This account is associated with multiple societies. " +
                    "Please specify your society by sending the 'x-tenant-id' header.",
                    409,
                    "MULTI_SOCIETY_USER"
                );
            }

            societyId = mappings[0].societyId;
        }

        // 2. Find user in the ops DB, scoped by societyId
        const user = await AuthRepository.findUserByIdentifier(societyId, identifier);
        if (!user) {
            throw new AppError(AUTH_ERRORS.INVALID_CREDENTIALS, 401);
        }

        // 3. Check if active
        if (!user.isActive) {
            throw new AppError(AUTH_ERRORS.USER_INACTIVE, 403);
        }

        // 4. Verify password
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            throw new AppError(AUTH_ERRORS.INVALID_CREDENTIALS, 401);
        }

        // 5. Generate tokens (societyId in payload, NOT databaseName)
        const payload = {
            id:        user._id,
            role:      user.role,
            societyId: user.societyId,
        };

        const accessToken  = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        // 6. Save refresh token
        await AuthRepository.saveRefreshToken(user._id, refreshToken);

        // Strip sensitive fields
        user.password     = undefined;
        user.refreshToken = undefined;

        // 7. Return permissions matrix for the frontend
        const permissions = getRolePermissions(user.role);

        return { user, accessToken, refreshToken, permissions };
    }

    /**
     * @param {string} email
     * @param {string} password
     */
    async superAdminLogin(email, password) {
        // 1. Find Super Admin in master DB
        const admin = await AuthRepository.findSuperAdminByEmail(email);
        if (!admin) {
            throw new AppError(AUTH_ERRORS.INVALID_CREDENTIALS, 401);
        }

        if (!admin.isActive) {
            throw new AppError(AUTH_ERRORS.USER_INACTIVE, 403);
        }

        // 2. Verify password
        const isMatch = await admin.comparePassword(password);
        if (!isMatch) {
            throw new AppError(AUTH_ERRORS.INVALID_CREDENTIALS, 401);
        }

        // 3. Generate tokens (NO societyId in payload)
        const payload = {
            id:   admin._id,
            role: admin.role, // "super_admin"
        };

        const accessToken  = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        // 4. Save refresh token
        await AuthRepository.saveSuperAdminRefreshToken(admin._id, refreshToken);

        // Strip sensitive fields
        admin.password     = undefined;
        admin.refreshToken = undefined;

        // 5. Return permissions matrix for the frontend
        const permissions = getRolePermissions(admin.role);

        return { user: admin, accessToken, refreshToken, permissions };
    }

    async refreshToken(token) {
        if (!token) {
            throw new AppError(AUTH_ERRORS.TOKEN_MISSING, 400);
        }

        let decoded;
        try {
            decoded = verifyToken(token, true);
        } catch (error) {
            throw new AppError(AUTH_ERRORS.TOKEN_INVALID, 401);
        }

        // Verify user still exists and is active in the ops DB
        const user = await AuthRepository.findUserById(decoded.societyId, decoded.id);
        if (!user || !user.isActive) {
            throw new AppError(AUTH_ERRORS.USER_INACTIVE, 403);
        }

        const payload = {
            id:        user._id,
            role:      user.role,
            societyId: decoded.societyId,
        };

        const accessToken     = generateAccessToken(payload);
        const newRefreshToken = generateRefreshToken(payload);

        await AuthRepository.saveRefreshToken(user._id, newRefreshToken);

        return { accessToken, refreshToken: newRefreshToken };
    }

    async logout(userId, role) {
        if (role === "super_admin") {
            await AuthRepository.clearSuperAdminRefreshToken(userId);
        } else {
            await AuthRepository.clearRefreshToken(userId);
        }
        return true;
    }
}

module.exports = new AuthService();
