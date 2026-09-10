"use strict";

const VehicleService = require("./vehicle.service");
const { sendSuccess } = require("../../utils/response.utils");

class VehicleController {
    async lookupVehicle(req, res, next) {
        try {
            const data = await VehicleService.lookupVehicle(req.user.societyId, req.params.regNumber);
            return sendSuccess(res, 200, "Vehicle found", data);
        } catch (error) {
            next(error);
        }
    }
}
module.exports = new VehicleController();
