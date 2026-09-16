"use strict";

const { getOperationsConnection } = require("../../config/operationsDb");
const AppError = require("../../common/AppError");

class GuardService {
    async getMyAssignedGate(guardId, societyId) {
        const opsDb = getOperationsConnection();
        const GuardGateAssignment = opsDb.model("GuardGateAssignment");
        
        const activeAssignment = await GuardGateAssignment.findOne({
            societyId,
            guardId,
            isActive: true,
        }).populate("gateId").sort({ createdAt: -1 });

        if (!activeAssignment) {
            return null;
        }

        return activeAssignment;
    }
}
module.exports = new GuardService();
