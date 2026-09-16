"use strict";

const GuardService = require("./guard.service");
const { sendSuccess } = require("../../utils/response.utils");

class GuardController {
    /**
     * @desc    Get currently assigned gate for the guard
     * @route   GET /api/v1/guard/my-gate
     */
    async getMyAssignedGate(req, res, next) {
        try {
            const data = await GuardService.getMyAssignedGate(req.user.id, req.user.societyId);
            return sendSuccess(res, 200, "Assigned gate fetched successfully", data);
        } catch (error) {
            next(error);
        }
    }
}
module.exports = new GuardController();
