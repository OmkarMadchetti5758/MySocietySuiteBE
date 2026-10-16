"use strict";

const express = require("express");
const SocietySetupController = require("./societySetup.controller");
const authenticate = require("../../middleware/authenticate");
const injectSocietyId = require("../../middleware/injectSocietyId");
const checkPermission = require("../../middleware/checkPermission");
const upload = require("../../middleware/upload.middleware");
const documentUpload = require("../../middleware/documentUpload.middleware");
const { MODULES, PERMISSION_LEVELS } = require("../../common/constants");

const router = express.Router();

router.use(authenticate, injectSocietyId);

// Setup status & draft
router.get(
    "/status",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    SocietySetupController.getStatus.bind(SocietySetupController)
);

router.get(
    "/draft",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    SocietySetupController.getDraft.bind(SocietySetupController)
);

router.put(
    "/draft",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.FULL),
    SocietySetupController.saveDraft.bind(SocietySetupController)
);

// Per-step endpoints
router.put(
    "/step/1",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.FULL),
    upload.single("logo"),
    SocietySetupController.saveStep1.bind(SocietySetupController)
);

router.put(
    "/step/2",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.FULL),
    SocietySetupController.saveStep2.bind(SocietySetupController)
);

router.put(
    "/step/3",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.FULL),
    SocietySetupController.saveStep3.bind(SocietySetupController)
);

router.put(
    "/step/4",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.FULL),
    SocietySetupController.saveStep4.bind(SocietySetupController)
);

router.put(
    "/step/5",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.FULL),
    SocietySetupController.saveStep5.bind(SocietySetupController)
);

// Activate
router.post(
    "/activate",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.FULL),
    SocietySetupController.activate.bind(SocietySetupController)
);

// Document upload helper
router.post(
    "/upload-doc",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.FULL),
    documentUpload.single("file"),
    SocietySetupController.uploadDocument.bind(SocietySetupController)
);

module.exports = router;
