"use strict";

const express = require("express");
const BlockController = require("./block.controller");
const authenticate = require("../../middleware/authenticate");
const injectSocietyId = require("../../middleware/injectSocietyId");
const checkPermission = require("../../middleware/checkPermission");
const { MODULES, PERMISSION_LEVELS } = require("../../common/constants");

const router = express.Router();

router.use(authenticate, injectSocietyId);

router.get(
    "/",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    BlockController.getWings.bind(BlockController)
);
router.put(
    "/",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.FULL),
    BlockController.saveWings.bind(BlockController)
);

router.get(
    "/staff",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    BlockController.getStaffList.bind(BlockController)
);

module.exports = router;
