"use strict";

const ResidentService = require("./resident.service");
const { sendSuccess } = require("../../utils/response.utils");

class ResidentController {
    async getResidents(req, res, next) {
        try {
            const { page, limit, search } = req.query;
            const result = await ResidentService.getResidents(req.societyId, page, limit, search);
            return sendSuccess(res, 200, "Residents retrieved successfully", result);
        } catch (error) {
            next(error);
        }
    }

    async inviteResident(req, res, next) {
        try {
            const result = await ResidentService.inviteResident(req.societyId, req.body);
            return sendSuccess(res, 201, "Resident invited successfully", result);
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new ResidentController();
