"use strict";

const express = require("express");
const ResidentController = require("./resident.controller");
const validate = require("../../middleware/validate");
const authenticate = require("../../middleware/authenticate");
const injectSocietyId = require("../../middleware/injectSocietyId");
const checkPermission = require("../../middleware/checkPermission");
const { MODULES, PERMISSION_LEVELS } = require("../../common/constants");
const { createResidentValidation } = require("./resident.validation");

const excelUpload = require("../../middleware/excelUpload.middleware");

const router = express.Router();

router.use(authenticate, injectSocietyId);

// Download bulk upload template for residents
router.get(
    "/bulk-upload/template",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    ResidentController.downloadBulkUploadTemplate
);

// Bulk upload residents from Excel
router.post(
    "/bulk-upload",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.FULL),
    excelUpload.single("file"),
    ResidentController.bulkUploadResidents
);

// Get all residents
router.get(
    "/",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    ResidentController.getResidents
);

router.post(
    "/",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.FULL),
    createResidentValidation,
    validate,
    ResidentController.inviteResident
);
router.put(
    "/:userId",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.FULL),
    ResidentController.updateResident
);

router.delete(
    "/:userId",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.FULL),
    ResidentController.deleteResident
);

module.exports = router;
