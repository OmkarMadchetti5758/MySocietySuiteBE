"use strict";

const express = require("express");
const FlatController = require("./flat.controller");
const authenticate = require("../../middleware/authenticate");
const injectSocietyId = require("../../middleware/injectSocietyId");
const checkPermission = require("../../middleware/checkPermission");
const { MODULES, PERMISSION_LEVELS } = require("../../common/constants");

const router = express.Router();

router.use(authenticate, injectSocietyId);

/**
 * @route   GET /api/v1/flats
 * @desc    Get flats for the current society
 * @access  Private — society_flat_setup VIEW
 */
router.get(
    "/",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    FlatController.getFlats.bind(FlatController)
);

/**
 * @route   POST /api/v1/flats
 * @desc    Create a new flat
 * @access  Private — society_flat_setup MANAGE
 */
router.post(
    "/",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.MANAGE),
    FlatController.createFlat.bind(FlatController)
);

/**
 * @route   GET /api/v1/flats/:flatId
 * @desc    Get a specific flat by ID
 * @access  Private — society_flat_setup VIEW
 */
router.get(
    "/:flatId",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    FlatController.getFlatById.bind(FlatController)
);

/**
 * @route   PUT /api/v1/flats/:flatId
 * @desc    Update a specific flat by ID
 * @access  Private — society_flat_setup MANAGE
 */
router.put(
    "/:flatId",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.MANAGE),
    FlatController.updateFlat.bind(FlatController)
);

/**
 * @route   POST /api/v1/flats/:flatId/allocate
 * @desc    Allocate a vacant flat to a new resident
 * @access  Private — society_flat_setup MANAGE
 */
router.post(
    "/:flatId/allocate",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.MANAGE),
    FlatController.allocateResident.bind(FlatController)
);

module.exports = router;
