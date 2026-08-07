"use strict";

const AuthRepository = require("./auth.repository");
const AppError = require("../../common/AppError");
const { AUTH_ERRORS } = require("./auth.constants");
const { getTenantConnection } = require("../../config/tenantDb");
const { generateAccessToken, generateRefreshToken, verifyToken } = require("../../utils/jwt.utils");
const { getRolePermissions } = require("../../common/constants");

class AuthService {
    async login(identifier, password, databaseNameHeader) {
        let databaseName = databaseNameHeader;

        // 1. Identify Society Database
        if (!databaseName) {
            databaseName = await AuthRepository.getDatabaseNameForUser(identifier);
            if (!databaseName) {
                throw new AppError(AUTH_ERRORS.SOCIETY_NOT_FOUND, 404);
            }
        } else {
            // Verify if society exists and is active
            const society = await AuthRepository.getSocietyByDatabaseName(databaseName);
            if (!society) {
                throw new AppError(AUTH_ERRORS.SOCIETY_NOT_FOUND, 404);
            }
        }

        // 2. Connect to Tenant DB
        const tenantDb = await getTenantConnection(databaseName);

        // 3. Find User
        const user = await AuthRepository.findUserByIdentifier(tenantDb, identifier);
        if (!user) {
            throw new AppError(AUTH_ERRORS.INVALID_CREDENTIALS, 401);
        }

        // 4. Check if active
        if (!user.isActive) {
            throw new AppError(AUTH_ERRORS.USER_INACTIVE, 403);
        }

        // 5. Verify Password
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            throw new AppError(AUTH_ERRORS.INVALID_CREDENTIALS, 401);
        }

        // 6. Generate Tokens
        const payload = {
            id: user._id,
            role: user.role,
            databaseName: databaseName
        };

        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        // 7. Save refresh token
        await AuthRepository.saveRefreshToken(tenantDb, user._id, refreshToken);

        // Remove password before returning
        user.password = undefined;
        user.refreshToken = undefined;

        // 8. Get Role Permissions
        const permissions = getRolePermissions(user.role);

        return {
            user,
            accessToken,
            refreshToken,
            permissions
        };
    }

    async refreshToken(token, databaseName) {
        if (!token) {
            throw new AppError(AUTH_ERRORS.TOKEN_MISSING, 400);
        }

        let decoded;
        try {
            decoded = verifyToken(token, true);
        } catch (error) {
            throw new AppError(AUTH_ERRORS.TOKEN_INVALID, 401);
        }

        // Connect to tenant DB to verify user
        const tenantDb = await getTenantConnection(decoded.databaseName);
        const user = await AuthRepository.findUserById(tenantDb, decoded.id);

        if (!user || !user.isActive) {
            throw new AppError(AUTH_ERRORS.USER_INACTIVE, 403);
        }

        // In a real implementation, you'd also check if the refresh token matches the one in DB
        // User.findOne({ _id: decoded.id, refreshToken: token })

        const payload = {
            id: user._id,
            role: user.role,
            databaseName: decoded.databaseName
        };

        const accessToken = generateAccessToken(payload);
        const newRefreshToken = generateRefreshToken(payload);

        await AuthRepository.saveRefreshToken(tenantDb, user._id, newRefreshToken);

        return {
            accessToken,
            refreshToken: newRefreshToken
        };
    }

    async logout(tenantDb, userId) {
        await AuthRepository.clearRefreshToken(tenantDb, userId);
        return true;
    }
}

module.exports = new AuthService();
