"use strict";

const SocietySetupService = require("./societySetup.service");
const { sendSuccess } = require("../../utils/response.utils");
const { uploadMulterFile, STORAGE_FOLDERS } = require("../../services/storage.service");

class SocietySetupController {
    /**
     * GET /api/v1/societies/setup/status
     */
    async getStatus(req, res, next) {
        try {
            const result = await SocietySetupService.getStatus(req.societyId);
            return sendSuccess(res, 200, "Setup status retrieved successfully", result);
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/v1/societies/setup/draft
     */
    async getDraft(req, res, next) {
        try {
            const draft = await SocietySetupService.getDraft(req.societyId);
            return sendSuccess(res, 200, "Setup draft loaded successfully", draft);
        } catch (error) {
            next(error);
        }
    }

    /**
     * PUT /api/v1/societies/setup/draft
     */
    async saveDraft(req, res, next) {
        try {
            const result = await SocietySetupService.saveDraft(req.societyId, req.body, req.user?._id);
            return sendSuccess(res, 200, "Setup draft saved successfully", result);
        } catch (error) {
            next(error);
        }
    }

    /**
     * PUT /api/v1/societies/setup/step/1
     */
    async saveStep1(req, res, next) {
        try {
            const updateData = { ...req.body };
            if (req.file) {
                const uploaded = await uploadMulterFile(req.file, STORAGE_FOLDERS.SOCIETY, req.societyId);
                updateData.logo = uploaded.url;
            }

            const result = await SocietySetupService.saveStep1(req.societyId, updateData);
            return sendSuccess(res, 200, "Step 1: Society details saved successfully", result);
        } catch (error) {
            next(error);
        }
    }

    /**
     * PUT /api/v1/societies/setup/step/2
     */
    async saveStep2(req, res, next) {
        try {
            const result = await SocietySetupService.saveStep2(req.societyId, req.body);
            return sendSuccess(res, 200, "Step 2: Property inventory saved successfully", result);
        } catch (error) {
            next(error);
        }
    }

    /**
     * PUT /api/v1/societies/setup/step/3
     */
    async saveStep3(req, res, next) {
        try {
            const amenities = req.body.amenities || req.body;
            const result = await SocietySetupService.saveStep3(req.societyId, amenities);
            return sendSuccess(res, 200, "Step 3: Amenities saved successfully", result);
        } catch (error) {
            next(error);
        }
    }

    /**
     * PUT /api/v1/societies/setup/step/4
     */
    async saveStep4(req, res, next) {
        try {
            const contacts = req.body.contacts || req.body;
            const result = await SocietySetupService.saveStep4(req.societyId, contacts);
            return sendSuccess(res, 200, "Step 4: Contacts saved successfully", result);
        } catch (error) {
            next(error);
        }
    }

    /**
     * PUT /api/v1/societies/setup/step/5
     */
    async saveStep5(req, res, next) {
        try {
            const documents = req.body.documents || req.body;
            const result = await SocietySetupService.saveStep5(req.societyId, documents, req.user?._id);
            return sendSuccess(res, 200, "Step 5: Documents saved successfully", result);
        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /api/v1/societies/setup/activate
     */
    async activate(req, res, next) {
        try {
            const result = await SocietySetupService.activateSociety(req.societyId, req.body, req.user?._id);
            return sendSuccess(res, 200, "Society setup activated successfully!", result);
        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /api/v1/societies/setup/upload-doc
     */
    async uploadDocument(req, res, next) {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, message: "No file uploaded" });
            }
            const uploaded = await uploadMulterFile(req.file, STORAGE_FOLDERS.DOCUMENTS || "documents", req.societyId);
            return sendSuccess(res, 200, "Document file uploaded successfully", {
                fileUrl: uploaded.url,
                fileName: req.file.originalname,
                fileSize: req.file.size,
                fileType: req.file.mimetype.includes("pdf") ? "pdf" : "image",
            });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new SocietySetupController();
