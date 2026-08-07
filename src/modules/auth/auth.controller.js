"use strict";

const AuthService = require("./auth.service");
const { sendSuccess } = require("../../utils/response.utils");

class AuthController {
    /**
     * @desc    Login user
     * @route   POST /api/v1/auth/login
     * @access  Public
     */
    async login(req, res, next) {
        try {
            const { identifier, password } = req.body;
            // Get optional database name from header (x-database-name)
            const databaseNameHeader = req.tenantInfo?.databaseName;

            const data = await AuthService.login(identifier, password, databaseNameHeader);

            return sendSuccess(res, 200, "Login successful", data);
        } catch (error) {
            next(error);
        }
    }

    /**
     * @desc    Refresh access token
     * @route   POST /api/v1/auth/refresh-token
     * @access  Public
     */
    async refreshToken(req, res, next) {
        try {
            const { refreshToken } = req.body;
            const data = await AuthService.refreshToken(refreshToken);

            return sendSuccess(res, 200, "Token refreshed successfully", data);
        } catch (error) {
            next(error);
        }
    }

    /**
     * @desc    Logout user
     * @route   POST /api/v1/auth/logout
     * @access  Private
     */
    async logout(req, res, next) {
        try {
            await AuthService.logout(req.tenantDb, req.user.id);
            return sendSuccess(res, 200, "Logged out successfully");
        } catch (error) {
            next(error);
        }
    }

    /**
     * @desc    Get current user profile
     * @route   GET /api/v1/auth/me
     * @access  Private
     */
    async getMe(req, res, next) {
        try {
            // Using tenantDb attached by authenticate middleware
            const User = req.tenantDb.model("User");
            const user = await User.findById(req.user.id);

            return sendSuccess(res, 200, "User profile fetched", { user });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new AuthController();
