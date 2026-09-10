"use strict";

const AuthService = require("./auth.service");
const { sendSuccess } = require("../../utils/response.utils");

class AuthController {
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

    async superAdminLogin(req, res, next) {
        try {
            const { email, password } = req.body;
            const data = await AuthService.superAdminLogin(email, password);
            return sendSuccess(res, 200, "Super Admin login successful", data);
        } catch (error) {
            next(error);
        }
    }

    async refreshToken(req, res, next) {
        try {
            const { refreshToken } = req.body;
            const data = await AuthService.refreshToken(refreshToken);

            return sendSuccess(res, 200, "Token refreshed successfully", data);
        } catch (error) {
            next(error);
        }
    }

    async logout(req, res, next) {
        try {
            await AuthService.logout(req.user.id, req.user.role);
            return sendSuccess(res, 200, "Logged out successfully");
        } catch (error) {
            next(error);
        }
    }

    async getMe(req, res, next) {
        try {
            let user;
            if (req.user.role === "super_admin") {
                const { getMasterConnection } = require("../../config/masterDb");
                const masterDb = getMasterConnection();
                const SuperAdmin = masterDb.model("SuperAdmin");
                user = await SuperAdmin.findById(req.user.id);
            } else {
                const User = req.opsDb.model("User");
                user = await User.findOne({ _id: req.user.id, societyId: req.user.societyId });
                if (user) {
                    const userObj = user.toObject();
                    userObj.roleKeys = req.user.roleKeys;
                    userObj.flatId = req.user.flatId;
                    user = userObj;
                }
            }

            return sendSuccess(res, 200, "User profile fetched", { user });
        } catch (error) {
            next(error);
        }
    }

    async updateMe(req, res, next) {
        try {
            const data = await AuthService.updateMe(req.user, req.body);
            return sendSuccess(res, 200, "Profile updated successfully", data);
        } catch (error) {
            next(error);
        }
    }

    async refreshPermissions(req, res, next) {
        try {
            if (req.user.role === "super_admin" || !req.user.societyId) {
                const permissions = require("../../common/constants").getRolePermissions(req.user.role);
                return sendSuccess(res, 200, "Permissions refreshed", { permissions });
            }

            const data = await AuthService.refreshPermissions(
                req.user.id,
                req.user.societyId,
                req.user.role
            );

            return sendSuccess(res, 200, "Permissions refreshed", data);
        } catch (error) {
            next(error);
        }
    }

    async validateInvite(req, res, next) {
        try {
            const { token } = req.query;
            const data = await AuthService.validateInvite(token);
            return sendSuccess(res, 200, "Invite token is valid", data);
        } catch (error) {
            next(error);
        }
    }

    async activateInvite(req, res, next) {
        try {
            const { token, password } = req.body;
            const data = await AuthService.activateInvite(token, password);
            return sendSuccess(res, 200, "Account activated successfully", data);
        } catch (error) {
            next(error);
        }
    }
    async resendInvite(req, res, next) {
        try {
            const { email } = req.body;
            const data = await AuthService.resendInvite(email);
            return sendSuccess(res, 200, "Invite resent successfully", data);
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new AuthController();
