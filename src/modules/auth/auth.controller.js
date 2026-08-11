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
            // societyId comes from tenantResolver (x-tenant-id header), not from request body
            const societyIdHeader = req.tenantInfo?.societyId;

            const data = await AuthService.login(identifier, password, societyIdHeader);

            return sendSuccess(res, 200, "Login successful", data);
        } catch (error) {
            next(error);
        }
    }

    /**
     * @desc    Super Admin Login
     * @route   POST /api/v1/auth/super-admin/login
     * @access  Public
     */
    async superAdminLogin(req, res, next) {
        try {
            const { email, password } = req.body;
            const data = await AuthService.superAdminLogin(email, password);
            return sendSuccess(res, 200, "Super Admin login successful", data);
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
     * @access  Private (requires authenticate middleware)
     */
    async logout(req, res, next) {
        try {
            await AuthService.logout(req.user.id, req.user.role);
            return sendSuccess(res, 200, "Logged out successfully");
        } catch (error) {
            next(error);
        }
    }

    /**
     * @desc    Get current user profile
     * @route   GET /api/v1/auth/me
     * @access  Private (requires authenticate middleware)
     */
    async getMe(req, res, next) {
        try {
            let user;
            if (req.user.role === "super_admin") {
                const { getMasterConnection } = require("../../config/masterDb");
                const masterDb = getMasterConnection();
                const SuperAdmin = masterDb.model("SuperAdmin");
                user = await SuperAdmin.findById(req.user.id);
            } else {
                // Use req.opsDb (attached by authenticate middleware)
                const User = req.opsDb.model("User");
                user = await User.findOne({ _id: req.user.id, societyId: req.user.societyId });
            }

            return sendSuccess(res, 200, "User profile fetched", { user });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new AuthController();
