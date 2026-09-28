"use strict";

const service = require("./dashboard.service");
const { sendSuccess } = require("../../utils/response.utils");

const getAdminDashboard = async (req, res, next) => {
    try {
        const stats = await service.getAdminDashboardStats(req.societyId);
        return sendSuccess(res, 200, "Dashboard statistics retrieved successfully", stats);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getAdminDashboard
};
