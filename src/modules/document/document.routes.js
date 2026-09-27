"use strict";

const express = require("express");
const DocumentController = require("./document.controller");
const documentUpload = require("../../middleware/documentUpload.middleware");
const authenticate = require("../../middleware/authenticate");
const injectSocietyId = require("../../middleware/injectSocietyId");
const checkPermission = require("../../middleware/checkPermission");
const { MODULES, PERMISSION_LEVELS } = require("../../common/constants");

const router = express.Router({ mergeParams: true });

router.use(authenticate, injectSocietyId);

router.post(
    "/",
    checkPermission(MODULES.DOCUMENTS_MANAGER, PERMISSION_LEVELS.MANAGE),
    documentUpload.single("file"),
    DocumentController.uploadDocument
);

router.get(
    "/",
    checkPermission(MODULES.DOCUMENTS_MANAGER, PERMISSION_LEVELS.VIEW),
    DocumentController.getDocuments
);

router.get(
    "/:id/download",
    checkPermission(MODULES.DOCUMENTS_MANAGER, PERMISSION_LEVELS.VIEW),
    DocumentController.downloadDocument
);

router.put(
    "/:id",
    checkPermission(MODULES.DOCUMENTS_MANAGER, PERMISSION_LEVELS.MANAGE),
    documentUpload.single("file"),
    DocumentController.replaceDocument
);

router.delete(
    "/:id",
    checkPermission(MODULES.DOCUMENTS_MANAGER, PERMISSION_LEVELS.MANAGE),
    DocumentController.deleteDocument
);

module.exports = router;
