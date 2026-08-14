"use strict";

const express = require("express");
const BlockController = require("./block.controller");
const authenticate = require("../../middleware/authenticate");
const injectSocietyId = require("../../middleware/injectSocietyId");
const checkPermission = require("../../middleware/checkPermission");
const { MODULES, PERMISSION_LEVELS } = require("../../common/constants");

const router = express.Router();

router.use(authenticate, injectSocietyId);

/**
 * @route   GET /api/v1/blocks
 * @desc    Get wings/blocks for the current society
 * @access  Private — society_flat_setup VIEW
 */
router.get(
    "/",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    BlockController.getWings.bind(BlockController)
);

/**
 * @route   PUT /api/v1/blocks
 * @desc    Save/update all wings for the current society (upsert)
 * @access  Private — society_flat_setup FULL
 */
router.put(
    "/",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.FULL),
    BlockController.saveWings.bind(BlockController)
);

/**
 * @route   GET /api/v1/blocks/staff
 * @desc    Get list of staff/managers for dropdown in wing form
 * @access  Private — society_flat_setup VIEW
 */
router.get(
    "/staff",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    BlockController.getStaffList.bind(BlockController)
);

module.exports = router;
