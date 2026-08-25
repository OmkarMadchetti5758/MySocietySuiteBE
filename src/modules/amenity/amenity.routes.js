"use strict";

const express = require("express");
const AmenityController = require("./amenity.controller");
const authenticate = require("../../middleware/authenticate");
const checkPermission = require("../../middleware/checkPermission");
const injectSocietyId = require("../../middleware/injectSocietyId");
const { MODULES, PERMISSION_LEVELS } = require("../../common/constants");
const upload = require("../../middleware/upload.middleware");

const router = express.Router({ mergeParams: true });

router.use(authenticate);
router.use(injectSocietyId);

// ─── Amenities ────────────────────────────────────────────────────────────────

// Any authenticated user with at least VIEW can list amenities
router.get(
    "/",
    checkPermission(MODULES.AMENITY_BOOKING, PERMISSION_LEVELS.VIEW),
    AmenityController.getAmenities
);

router.get(
    "/:id",
    checkPermission(MODULES.AMENITY_BOOKING, PERMISSION_LEVELS.VIEW),
    AmenityController.getAmenityById
);

// Availability check — residents use this to see open slots
router.get(
    "/:id/availability",
    checkPermission(MODULES.AMENITY_BOOKING, PERMISSION_LEVELS.VIEW),
    AmenityController.checkAvailability
);

// FULL access required to create/update amenities (Admin / Facility Manager)
router.post(
    "/",
    checkPermission(MODULES.AMENITY_BOOKING, PERMISSION_LEVELS.FULL),
    upload.array("images", 5),
    AmenityController.createAmenity
);

router.patch(
    "/:id",
    checkPermission(MODULES.AMENITY_BOOKING, PERMISSION_LEVELS.FULL),
    upload.array("images", 5),
    AmenityController.updateAmenity
);

// ─── Slots ────────────────────────────────────────────────────────────────────

router.get(
    "/:id/slots",
    checkPermission(MODULES.AMENITY_BOOKING, PERMISSION_LEVELS.VIEW),
    AmenityController.getAmenitySlots
);

router.post(
    "/:id/slots",
    checkPermission(MODULES.AMENITY_BOOKING, PERMISSION_LEVELS.FULL),
    AmenityController.createAmenitySlot
);

router.patch(
    "/:id/slots/:slotId",
    checkPermission(MODULES.AMENITY_BOOKING, PERMISSION_LEVELS.FULL),
    AmenityController.updateAmenitySlot
);

module.exports = router;
