"use strict";

const express = require("express");
const router = express.Router();

const festivalController = require("./festival.controller");
const festivalValidation = require("./festival.validation");
const validate = require("../../middleware/validate");
const authenticate = require("../../middleware/authenticate");
const injectSocietyId = require("../../middleware/injectSocietyId");
const checkPermission = require("../../middleware/checkPermission");
const { MODULES, PERMISSION_LEVELS } = require("../../common/constants");

// Apply standard auth and society injection to all festival routes
router.use(authenticate);
router.use(injectSocietyId);

// GET /festivals (List)
router.get(
    "/",
    checkPermission(MODULES.COMMUNITY_EVENTS, PERMISSION_LEVELS.VIEW),
    festivalController.getFestivals
);

// GET /festivals/:id (Details)
router.get(
    "/:id",
    checkPermission(MODULES.COMMUNITY_EVENTS, PERMISSION_LEVELS.VIEW),
    festivalController.getFestivalById
);

// POST /festivals (Create)
router.post(
    "/",
    checkPermission(MODULES.COMMUNITY_EVENTS, PERMISSION_LEVELS.FULL),
    festivalValidation.createFestivalValidation,
    validate,
    festivalController.createFestival
);

// PATCH /festivals/:id (Update)
router.patch(
    "/:id",
    checkPermission(MODULES.COMMUNITY_EVENTS, PERMISSION_LEVELS.FULL),
    festivalValidation.updateFestivalValidation,
    validate,
    festivalController.updateFestival
);

// POST /festivals/:id/publish
router.post(
    "/:id/publish",
    checkPermission(MODULES.COMMUNITY_EVENTS, PERMISSION_LEVELS.FULL),
    festivalController.publishFestival
);

// POST /festivals/:id/unpublish
router.post(
    "/:id/unpublish",
    checkPermission(MODULES.COMMUNITY_EVENTS, PERMISSION_LEVELS.FULL),
    festivalController.unpublishFestival
);

// POST /festivals/:id/cancel
router.post(
    "/:id/cancel",
    checkPermission(MODULES.COMMUNITY_EVENTS, PERMISSION_LEVELS.FULL),
    festivalController.cancelFestival
);

// DELETE /festivals/:id (Only for DRAFTs)
router.delete(
    "/:id",
    checkPermission(MODULES.COMMUNITY_EVENTS, PERMISSION_LEVELS.FULL),
    festivalController.deleteFestival
);

module.exports = router;
