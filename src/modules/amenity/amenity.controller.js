"use strict";

const AmenityService = require("./amenity.service");
const { sendSuccess, sendError } = require("../../utils/response.utils");

class AmenityController {

    async createAmenity(req, res, next) {
        try {
            if (req.files && req.files.length > 0) {
                req.body.images = req.files.map((file) => `/uploads/${file.filename}`);
            }
            const amenity = await AmenityService.createAmenity(req.societyId, req.user.id, req.body);
            return sendSuccess(res, 201, "Amenity created successfully", amenity);
        } catch (error) {
            next(error);
        }
    }

    async getAmenities(req, res, next) {
        try {
            const amenities = await AmenityService.getAmenities(req.societyId, req.query);
            return sendSuccess(res, 200, "Amenities fetched successfully", amenities);
        } catch (error) {
            next(error);
        }
    }

    async getAmenityById(req, res, next) {
        try {
            const amenity = await AmenityService.getAmenityById(req.societyId, req.params.id);
            return sendSuccess(res, 200, "Amenity fetched successfully", amenity);
        } catch (error) {
            next(error);
        }
    }

    async updateAmenity(req, res, next) {
        try {
            // When updating via FormData, existing images might be passed as strings.
            // We append the newly uploaded files to whatever was passed (if anything).
            let currentImages = [];
            if (req.body.existingImages) {
                try {
                    currentImages = JSON.parse(req.body.existingImages);
                } catch(e) {
                    currentImages = Array.isArray(req.body.existingImages) ? req.body.existingImages : [req.body.existingImages];
                }
            }
            
            if (req.files && req.files.length > 0) {
                const newImages = req.files.map((file) => `/uploads/${file.filename}`);
                req.body.images = [...currentImages, ...newImages];
            } else if (currentImages.length > 0) {
                req.body.images = currentImages;
            }

            const amenity = await AmenityService.updateAmenity(req.societyId, req.params.id, req.body);
            return sendSuccess(res, 200, "Amenity updated successfully", amenity);
        } catch (error) {
            next(error);
        }
    }

    async createAmenitySlot(req, res, next) {
        try {
            const slot = await AmenityService.createAmenitySlot(
                req.societyId, req.params.id, req.user.id, req.body
            );
            return sendSuccess(res, 201, "Amenity slot created successfully", slot);
        } catch (error) {
            next(error);
        }
    }

    async getAmenitySlots(req, res, next) {
        try {
            const slots = await AmenityService.getAmenitySlots(req.societyId, req.params.id);
            return sendSuccess(res, 200, "Amenity slots fetched successfully", slots);
        } catch (error) {
            next(error);
        }
    }

    async updateAmenitySlot(req, res, next) {
        try {
            const slot = await AmenityService.updateAmenitySlot(
                req.societyId, req.params.id, req.params.slotId, req.body
            );
            return sendSuccess(res, 200, "Amenity slot updated successfully", slot);
        } catch (error) {
            next(error);
        }
    }

    async checkAvailability(req, res, next) {
        try {
            const { date } = req.query;
            const availability = await AmenityService.checkAvailability(req.societyId, req.params.id, date);
            return sendSuccess(res, 200, "Availability fetched successfully", availability);
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new AmenityController();
