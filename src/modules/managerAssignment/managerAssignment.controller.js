"use strict";

const ManagerAssignmentService = require("./managerAssignment.service");
const { sendSuccess, sendError } = require("../../utils/response.utils");

class ManagerAssignmentController {

    async listManagers(req, res, next) {
        try {
            const { societyId } = req.params;
            const { department, status, search } = req.query;
            const data = await ManagerAssignmentService.listManagers(societyId, {
                department, status, search,
            });
            return sendSuccess(res, 200, "Managers retrieved", { managers: data });
        } catch (err) {
            next(err);
        }
    }

    async searchResidents(req, res, next) {
        try {
            const { societyId } = req.params;
            const { q } = req.query;
            
            // If query is present but less than 2 chars, return empty to avoid spamming searches while typing
            if (q && q.length > 0 && q.length < 2) {
                return sendSuccess(res, 200, "Residents retrieved", { residents: [] });
            }
            
            const residents = await ManagerAssignmentService.searchResidents(societyId, q || "");
            return sendSuccess(res, 200, "Residents retrieved", { residents });
        } catch (err) {
            next(err);
        }
    }

    async assignExistingResident(req, res, next) {
        try {
            const { societyId } = req.params;
            const adminId = req.user.id;
            const { userId, roleKey, roleName, department, joiningDate } = req.body;

            if (!userId || !roleKey || !roleName || !department) {
                return sendError(res, 400, "userId, roleKey, roleName, and department are required");
            }

            const result = await ManagerAssignmentService.assignExistingResident(
                societyId,
                { userId, roleKey, roleName, department, joiningDate },
                adminId
            );
            return sendSuccess(res, 201, "Manager assigned successfully", result);
        } catch (err) {
            next(err);
        }
    }

    async inviteNewManager(req, res, next) {
        try {
            const { societyId } = req.params;
            const adminId = req.user.id;
            const { name, email, phone, roleKey, roleName, department, joiningDate } = req.body;

            if (!name || !roleKey || !roleName || !department) {
                return sendError(res, 400, "name, roleKey, roleName, and department are required");
            }
            if (!email && !phone) {
                return sendError(res, 400, "At least one of email or phone is required");
            }

            const result = await ManagerAssignmentService.inviteNewManager(
                societyId,
                { name, email, phone, roleKey, roleName, department, joiningDate },
                adminId
            );
            return sendSuccess(res, 201, "Manager invite sent", result);
        } catch (err) {
            next(err);
        }
    }

    async deactivateManager(req, res, next) {
        try {
            const { societyId, id } = req.params;
            const adminId = req.user.id;
            const result = await ManagerAssignmentService.deactivateManager(societyId, id, adminId);
            return sendSuccess(res, 200, "Manager deactivated", result);
        } catch (err) {
            next(err);
        }
    }

    async resendInvite(req, res, next) {
        try {
            const { societyId, id } = req.params;
            const adminId = req.user.id;
            const result = await ManagerAssignmentService.resendManagerInvite(societyId, id, adminId);
            return sendSuccess(res, 200, result.message, result);
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new ManagerAssignmentController();
