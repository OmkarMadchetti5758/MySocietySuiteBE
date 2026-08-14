"use strict";

const RoleService = require("./role.service");
const { sendSuccess } = require("../../utils/response.utils");

/**
 * RoleController
 *
 * Thin HTTP layer — validates inputs, delegates to RoleService, sends response.
 * All business logic lives in role.service.js.
 */
class RoleController {

    /**
     * @desc  List all society-level roles (with merged permissions)
     * @route GET /api/v1/societies/:societyId/roles
     * @access Private — committee_admin
     */
    async listRoles(req, res, next) {
        try {
            const { societyId } = req.params;
            const roles = await RoleService.listRoles(societyId);
            return sendSuccess(res, 200, "Roles fetched successfully", { roles });
        } catch (err) {
            next(err);
        }
    }

    /**
     * @desc  Get single role with full permission map + audit info
     * @route GET /api/v1/societies/:societyId/roles/:roleKey
     * @access Private — committee_admin
     */
    async getRole(req, res, next) {
        try {
            const { societyId, roleKey } = req.params;
            const role = await RoleService.getRole(societyId, roleKey);
            return sendSuccess(res, 200, "Role fetched successfully", { role });
        } catch (err) {
            next(err);
        }
    }

    /**
     * @desc  Partially update one or more module permissions for a role
     * @route PATCH /api/v1/societies/:societyId/roles/:roleKey
     * @access Private — committee_admin
     *
     * Body: {
     *   permissions: {
     *     billingAccounts: { enabled: false },
     *     staffManagement: { enabled: true, access: "view" }
     *   }
     * }
     */
    async patchRole(req, res, next) {
        try {
            const { societyId, roleKey } = req.params;
            const { permissions }        = req.body;

            if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
                const AppError = require("../../common/AppError");
                return next(new AppError("Request body must include a 'permissions' object.", 400));
            }

            const actor = {
                id:   req.user.id,
                name: req.user.name || "Unknown Admin",
            };

            const updated = await RoleService.patchRole(societyId, roleKey, permissions, actor);
            return sendSuccess(res, 200, "Role permissions updated successfully", { role: updated });
        } catch (err) {
            next(err);
        }
    }

    /**
     * @desc  Reset a role to the GLOBAL template (delete society-specific override)
     * @route POST /api/v1/societies/:societyId/roles/:roleKey/reset
     * @access Private — committee_admin
     */
    async resetRole(req, res, next) {
        try {
            const { societyId, roleKey } = req.params;

            const actor = {
                id:   req.user.id,
                name: req.user.name || "Unknown Admin",
            };

            const role = await RoleService.resetRole(societyId, roleKey, actor);
            return sendSuccess(res, 200, "Role reset to default template successfully", { role });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new RoleController();
