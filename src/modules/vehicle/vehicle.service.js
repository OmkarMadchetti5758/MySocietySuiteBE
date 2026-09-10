"use strict";

const { getOperationsConnection } = require("../../config/operationsDb");
const AppError = require("../../common/AppError");

class VehicleService {
    async lookupVehicle(societyId, regNumber) {
        const opsDb = getOperationsConnection();
        const Vehicle = opsDb.model("Vehicle");
        
        const vehicle = await Vehicle.findOne({
            societyId,
            regNumber: regNumber.toUpperCase().trim(),
            isActive: true,
        }).populate("flatId").populate("residentId");

        if (!vehicle) {
            throw new AppError("Vehicle not found", 404);
        }

        return vehicle;
    }
}
module.exports = new VehicleService();
