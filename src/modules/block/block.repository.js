"use strict";

const { getOperationsConnection } = require("../../config/operationsDb");
const { getMasterConnection } = require("../../config/masterDb");

class BlockRepository {
    _getModel() {
        return getOperationsConnection().model("Block");
    }

    _getStaffModel() {
        return getOperationsConnection().model("Staff");
    }

    _getSocietyModel() {
        return getMasterConnection().model("Society");
    }

    async getBlocksBySociety(societyId) {
        const Block = this._getModel();
        return Block.findOne({ societyId })
            .populate("wings.assignedStaff", "name role phone")
            .lean();
    }

    async upsertBlocks(societyId, wings, commercialUnits) {
        const Block = this._getModel();
        const update = { societyId };
        if (wings !== undefined) update.wings = wings;
        if (commercialUnits !== undefined) update.commercialUnits = commercialUnits;

        return Block.findOneAndUpdate(
            { societyId },
            { $set: update },
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

    async getSocietyById(societyId) {
        const Society = this._getSocietyModel();
        return Society.findById(societyId).lean();
    }

    async updateSocietyData(societyId, updates) {
        const Society = this._getSocietyModel();
        return Society.findByIdAndUpdate(societyId, { $set: updates }, { new: true }).lean();
    }
}

module.exports = new BlockRepository();
