"use strict";

const express = require("express");
const controller = require("./aiAssistant.controller");
const authenticate = require("../../middleware/authenticate");
const injectSocietyId = require("../../middleware/injectSocietyId");
const checkPermission = require("../../middleware/checkPermission");
const { MODULES, PERMISSION_LEVELS } = require("../../common/constants");

const router = express.Router();

router.use(authenticate, injectSocietyId);

router.post(
    "/",
    checkPermission(MODULES.AI_ASSISTANT, PERMISSION_LEVELS.VIEW),
    controller.askAssistant
);

module.exports = router;
