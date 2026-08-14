"use strict";

const express = require("express");
const ResidentController = require("./resident.controller");
const validate = require("../../middleware/validate");
const authenticate = require("../../middleware/authenticate");
const injectSocietyId = require("../../middleware/injectSocietyId");
const checkPermission = require("../../middleware/checkPermission");
const { MODULES, PERMISSION_LEVELS } = require("../../common/constants");
const { createResidentValidation } = require("./resident.validation");

const router = express.Router();

router.use(authenticate, injectSocietyId);

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

module.exports = router;
