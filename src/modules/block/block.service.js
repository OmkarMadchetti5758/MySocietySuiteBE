"use strict";

const BlockRepository = require("./block.repository");
const AppError = require("../../common/AppError");

class BlockService {
    async getWings(societyId) {
        if (!societyId) throw new AppError("Society ID is required", 400);
        const blockDoc = await BlockRepository.getBlocksBySociety(societyId);
        return blockDoc || { societyId, wings: [] };
    }

    async saveWings(societyId, wings) {
        if (!societyId) throw new AppError("Society ID is required", 400);
        if (!Array.isArray(wings)) throw new AppError("Wings must be an array", 400);
        return BlockRepository.upsertBlocks(societyId, wings);
    }

    async getStaffList(societyId) {
        if (!societyId) throw new AppError("Society ID is required", 400);
        return BlockRepository.getStaffList(societyId);
    }
}

module.exports = new BlockService();
