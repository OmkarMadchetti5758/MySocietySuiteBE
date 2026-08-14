"use strict";

const { getOperationsConnection } = require("../../config/operationsDb");

class BlockRepository {
    _getModel() {
        return getOperationsConnection().model("Block");
    }

    _getStaffModel() {
        return getOperationsConnection().model("Staff");
    }

    async getBlocksBySociety(societyId) {
        const Block = this._getModel();
        return Block.findOne({ societyId })
            .populate("wings.assignedStaff", "name role phone")
            .lean();
    }

    async upsertBlocks(societyId, wings) {
        const Block = this._getModel();
        return Block.findOneAndUpdate(
            { societyId },
            { societyId, wings },
            { new: true, upsert: true, runValidators: true }
        )
            .populate("wings.assignedStaff", "name role phone")
            .lean();
    }

    async getStaffList(societyId) {
        const Staff = this._getStaffModel();
        return Staff.find({ societyId, isActive: true })
            .select("_id name role")
            .lean();
    }
}

module.exports = new BlockRepository();
