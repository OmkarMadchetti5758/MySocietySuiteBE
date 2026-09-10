"use strict";

const SosService = require("./sos.service");
const { sendSuccess } = require("../../utils/response.utils");

class SosController {
    async triggerSos(req, res, next) {
        try {
            const data = await SosService.triggerSos(req.user.societyId, req.user.id, req.user.flatId);
            return sendSuccess(res, 201, "SOS Alert Triggered", data);
        } catch (error) {
            next(error);
        }
    }

    async acknowledgeSos(req, res, next) {
        try {
            const data = await SosService.acknowledgeSos(req.params.id, req.user.societyId, req.user.id);
            return sendSuccess(res, 200, "SOS Acknowledged", data);
        } catch (error) {
            next(error);
        }
    }

    async resolveSos(req, res, next) {
        try {
            const { resolutionNote } = req.body;
            const data = await SosService.resolveSos(req.params.id, req.user.societyId, req.user.id, resolutionNote);
            return sendSuccess(res, 200, "SOS Resolved", data);
        } catch (error) {
            next(error);
        }
    }
}
module.exports = new SosController();
