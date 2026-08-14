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
                    if (!cleaned.assignedStaff) {
                        delete cleaned.assignedStaff;
                    }
                    // Coerce numeric strings to numbers
                    if (cleaned.totalFloors !== undefined && cleaned.totalFloors !== '') {
                        cleaned.totalFloors = Number(cleaned.totalFloors);
                    }
                    if (cleaned.totalFlats !== undefined && cleaned.totalFlats !== '') {
                        cleaned.totalFlats = Number(cleaned.totalFlats);
                    }
                    return cleaned;
                });
            }

            const blockDoc = await BlockService.saveWings(req.user.societyId, wings);
            return sendSuccess(res, 200, "Wings saved successfully", { blockDoc });
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
