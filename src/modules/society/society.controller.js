"use strict";

const SocietyService = require("./society.service");
const { sendSuccess } = require("../../utils/response.utils");

class SocietyController {
    async registerSociety(req, res, next) {
        try {
            const result = await SocietyService.registerSociety(req.body);
            return sendSuccess(res, 201, "Society registered successfully.", result);
        } catch (error) {
            next(error);
        }
    }

    async getActiveSocieties(req, res, next) {
        try {
            const societies = await SocietyService.getActiveSocieties();
            return sendSuccess(res, 200, "Active societies retrieved successfully", { societies });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new SocietyController();
