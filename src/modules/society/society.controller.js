"use strict";

const SocietyService = require("./society.service");
const { sendSuccess } = require("../../utils/response.utils");

class SocietyController {
    async registerSociety(req, res, next) {
        try {
            const result = await SocietyService.registerSociety(req.body);
            return sendSuccess(res, 201, "Society registered successfully.", result);
        } catch (error) {
            next(error);
        }
    }

    async getActiveSocieties(req, res, next) {
        try {
            const societies = await SocietyService.getActiveSocieties();
            return sendSuccess(res, 200, "Active societies retrieved successfully", { societies });
        } catch (error) {
            next(error);
        }
    }

    async getCurrentSociety(req, res, next) {
        try {
            const society = await SocietyService.getCurrentSociety(req.user.societyId);
            return sendSuccess(res, 200, "Society retrieved successfully", { society });
        } catch (error) {
            next(error);
        }
    }

    async updateCurrentSociety(req, res, next) {
        try {
            const updateData = { ...req.body };
            
            // Handle logo upload
            if (req.file) {
                updateData.logo = `/uploads/${req.file.filename}`;
            }

            // Parse blocks if sent as string (multipart/form-data can send arrays as strings)
            if (typeof updateData.blocks === 'string') {
                try {
                    updateData.blocks = JSON.parse(updateData.blocks);
                } catch (e) {
                    // Ignore parse error, maybe it's just a string block? Not likely if array
                }
            }
            if (updateData.blocks && !Array.isArray(updateData.blocks)) {
                updateData.blocks = [updateData.blocks];
            }

            // Extract address fields if they're flat
            if (updateData.address || updateData.city || updateData.state || updateData.country || updateData.pinCode) {
                updateData.address = {
                    street: updateData.address || "",
                    city: updateData.city || "",
                    state: updateData.state || "",
                    country: updateData.country || "",
                    zipCode: updateData.pinCode || ""
                };
            }

            const society = await SocietyService.updateCurrentSociety(req.user.societyId, updateData);
            return sendSuccess(res, 200, "Society updated successfully", { society });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new SocietyController();
