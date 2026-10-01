"use strict";

const ResidentService = require("./resident.service");
const { sendSuccess } = require("../../utils/response.utils");
const AppError = require("../../common/AppError");

class ResidentController {
    async getResidents(req, res, next) {
        try {
            const { page, limit, search } = req.query;
            const result = await ResidentService.getResidents(req.societyId, page, limit, search);
            return sendSuccess(res, 200, "Residents retrieved successfully", result);
        } catch (error) {
            next(error);
        }
    }

    // download bulk upload template for residents
    async downloadBulkUploadTemplate(req, res, next) {
        try {
            const buffer = ResidentService.generateResidentBulkUploadTemplate();

            res.setHeader(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );

            res.setHeader(
                "Content-Disposition",
                'attachment; filename="resident-bulk-upload-template.xlsx"'
            );

            return res.send(buffer);
        } catch (error) {
            next(error);
        }
    }

    // bulk upload residents from Excel
    async bulkUploadResidents(req, res, next) {
        try {
            if (!req.file) {
                throw new AppError("Please select an Excel (.xlsx) file to upload", 400);
            }

            const result = await ResidentService.processResidentBulkUpload(
                req.societyId,
                req.file.buffer
            );

            return sendSuccess(res, 200, "Bulk upload processed", result);
        } catch (error) {
            next(error);
        }
    }

    async inviteResident(req, res, next) {
        try {
            const result = await ResidentService.inviteResident(req.societyId, req.body);
            return sendSuccess(res, 201, "Resident invited successfully", result);
        } catch (error) {
            next(error);
        }
    }

    async updateResident(req, res, next) {
        try {
            const { userId } = req.params;
            const result = await ResidentService.updateResident(req.societyId, userId, req.body);
            return sendSuccess(res, 200, "Resident updated successfully", result);
        } catch (error) {
            next(error);
        }
    }

    async deleteResident(req, res, next) {
        try {
            const { userId } = req.params;
            await ResidentService.deleteResident(req.societyId, userId);
            return sendSuccess(res, 200, "Resident deleted successfully");
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new ResidentController();
