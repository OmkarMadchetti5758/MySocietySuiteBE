"use strict";

const SocietyService = require("./society.service");
const { sendSuccess } = require("../../utils/response.utils");
const { uploadMulterFile, STORAGE_FOLDERS } = require("../../services/storage.service");

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
            
            if (req.file) {
                const uploaded = await uploadMulterFile(req.file, STORAGE_FOLDERS.SOCIETY, req.societyId);
                updateData.logo = uploaded.url;
            }

            // Remove registrationNumber if empty to avoid sparse/unique index duplicate key error on empty strings
            if (!updateData.registrationNumber || String(updateData.registrationNumber).trim() === "" || updateData.registrationNumber === "undefined") {
                delete updateData.registrationNumber;
            } else {
                updateData.registrationNumber = String(updateData.registrationNumber).trim();
            }

            // Remove contact fields if empty string to avoid saving empty strings
            if (!updateData.contactPhone || updateData.contactPhone === "undefined") delete updateData.contactPhone;
            if (!updateData.contactEmail || updateData.contactEmail === "undefined") delete updateData.contactEmail;

            // Validate enum for societyType
            if (!updateData.societyType || !["Residential", "Commercial", "Mixed"].includes(updateData.societyType)) {
                delete updateData.societyType;
            }

            // Convert numberOfBlocks
            if (updateData.numberOfBlocks !== undefined) {
                updateData.numberOfBlocks = Number(updateData.numberOfBlocks) || 0;
            }

            // Parse blocks if sent as string (multipart/form-data can send arrays as strings)
            if (typeof updateData.blocks === 'string') {
                try {
                    updateData.blocks = JSON.parse(updateData.blocks);
                } catch (e) {
                    // Ignore parse error
                }
            }
            if (updateData.blocks && !Array.isArray(updateData.blocks)) {
                updateData.blocks = [updateData.blocks];
            }

            // Extract address fields if they're flat
            if (updateData.address || updateData.city || updateData.state || updateData.country || updateData.pinCode) {
                updateData.address = {
                    street: typeof updateData.address === 'string' ? updateData.address : "",
                    city: updateData.city || "",
                    state: updateData.state || "",
                    country: updateData.country || "India",
                    zipCode: updateData.pinCode || ""
                };
                delete updateData.city;
                delete updateData.state;
                delete updateData.country;
                delete updateData.pinCode;
            }

            // Handle subscriptionPlan mapping if sent
            const mongoose = require("mongoose");
            if (updateData.subscriptionPlan && mongoose.Types.ObjectId.isValid(updateData.subscriptionPlan)) {
                updateData.subscriptionPlanId = updateData.subscriptionPlan;
            }
            delete updateData.subscriptionPlan;

            const society = await SocietyService.updateCurrentSociety(req.user.societyId, updateData);
            return sendSuccess(res, 200, "Society updated successfully", { society });
        } catch (error) {
            console.error("updateCurrentSociety Error:", error);
            next(error);
        }
    }
}

module.exports = new SocietyController();
