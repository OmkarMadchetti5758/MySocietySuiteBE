"use strict";

const { getOperationsConnection } = require("../../config/operationsDb");
const AppError = require("../../common/AppError");
const { getIO } = require("../../config/socket");
const { SOS_STATUS } = require("../../common/constants");

class SosService {
    async triggerSos(societyId, residentId, flatId) {
        const opsDb = getOperationsConnection();
        const SOSAlert = opsDb.model("SOSAlert");
        
        const alert = await SOSAlert.create({
            societyId,
            residentId,
            flatId,
            status: SOS_STATUS.ACTIVE
        });

        const io = getIO();
        // Emit to a general society-guards room (or individual guards)
        io.to(`society_${societyId.toString()}_guards`).emit("sos-alert", alert);

        return alert;
    }

    async acknowledgeSos(alertId, societyId, guardId) {
        const opsDb = getOperationsConnection();
        const SOSAlert = opsDb.model("SOSAlert");
        
        const alert = await SOSAlert.findOne({ _id: alertId, societyId });
        if (!alert) throw new AppError("SOS alert not found", 404);

        if (alert.status !== SOS_STATUS.ACTIVE) {
            throw new AppError(`SOS Alert is already ${alert.status}`, 400);
        }

        alert.status = SOS_STATUS.ACKNOWLEDGED;
        alert.acknowledgedByGuardId = guardId;
        alert.acknowledgedAt = new Date();
        await alert.save();

        const io = getIO();
        // Notify resident that SOS was acknowledged
        io.to(`user_${alert.residentId.toString()}`).emit("sos-acknowledged", alert);
        // Notify other guards so they know it's handled
        io.to(`society_${societyId.toString()}_guards`).emit("sos-updated", alert);

        return alert;
    }

    async resolveSos(alertId, societyId, guardId, resolutionNote) {
        const opsDb = getOperationsConnection();
        const SOSAlert = opsDb.model("SOSAlert");
        
        const alert = await SOSAlert.findOne({ _id: alertId, societyId });
        if (!alert) throw new AppError("SOS alert not found", 404);

        alert.status = SOS_STATUS.RESOLVED;
        alert.resolutionNote = resolutionNote;
        alert.resolvedAt = new Date();
        await alert.save();

        const io = getIO();
        io.to(`user_${alert.residentId.toString()}`).emit("sos-resolved", alert);
        io.to(`society_${societyId.toString()}_guards`).emit("sos-updated", alert);

        return alert;
    }
}
module.exports = new SosService();
