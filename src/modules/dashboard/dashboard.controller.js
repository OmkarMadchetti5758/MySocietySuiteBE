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

const getResidentDashboard = async (req, res, next) => {
    try {
        const userId = req.user?.id;
        const societyId = req.societyId || req.user?.societyId;
        const stats = await service.getResidentDashboardStats(userId, societyId);
        return sendSuccess(res, 200, "Resident dashboard statistics retrieved successfully", stats);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getAdminDashboard,
    getResidentDashboard
};

