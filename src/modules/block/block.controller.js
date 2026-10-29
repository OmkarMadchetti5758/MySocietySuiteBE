"use strict";

const BlockService = require("./block.service");
const { sendSuccess } = require("../../utils/response.utils");

class BlockController {
    async getWings(req, res, next) {
        try {
            const blockDoc = await BlockService.getWings(req.user.societyId);
            return sendSuccess(res, 200, "Wings retrieved successfully", { blockDoc });
        } catch (error) {
            next(error);
        }
    }

    async saveWings(req, res, next) {
        try {
            let { wings } = req.body;

            // Clean each wing: remove empty assignedStaff so Mongoose doesn't try to cast "" to ObjectId
            if (Array.isArray(wings)) {
                wings = wings.map((wing) => {
                    const cleaned = { ...wing };
                    // Clean empty assignedStaff
                    if (!cleaned.assignedStaff) {
                        delete cleaned.assignedStaff;
                    }
                    // Coerce numeric fields and clean empty string values so Mongoose doesn't fail CastError
                    const numFields = ['totalFloors', 'unitsPerFloor', 'totalFlats', 'unitCount', 'carpetArea', 'builtUpArea', 'parking4W'];
                    numFields.forEach((field) => {
                        if (cleaned[field] !== undefined) {
                            if (cleaned[field] === '' || cleaned[field] === null) {
                                delete cleaned[field];
                            } else {
                                const parsed = Number(cleaned[field]);
                                if (!isNaN(parsed)) {
                                    cleaned[field] = parsed;
                                } else {
                                    delete cleaned[field];
                                }
                            }
                        }
                    });
                    return cleaned;
                });
            }

            const blockDoc = await BlockService.saveWings(req.user.societyId, wings);
            return sendSuccess(res, 200, "Wings saved successfully", { blockDoc });
        } catch (error) {
            next(error);
        }
    }

    async getInventory(req, res, next) {
        try {
            const inventory = await BlockService.getInventory(req.user.societyId);
            return sendSuccess(res, 200, "Inventory retrieved successfully", inventory);
        } catch (error) {
            next(error);
        }
    }

    async saveInventory(req, res, next) {
        try {
            const inventory = await BlockService.saveInventory(req.user.societyId, req.body);
            return sendSuccess(res, 200, "Inventory saved successfully", inventory);
        } catch (error) {
            next(error);
        }
    }

    async getStaffList(req, res, next) {
        try {
            const staff = await BlockService.getStaffList(req.user.societyId);
            return sendSuccess(res, 200, "Staff list retrieved successfully", { staff });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new BlockController();
