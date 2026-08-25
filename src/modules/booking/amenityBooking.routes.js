"use strict";

const express = require("express");
const AmenityBookingController = require("./amenityBooking.controller");
const authenticate = require("../../middleware/authenticate");
const checkPermission = require("../../middleware/checkPermission");
const injectSocietyId = require("../../middleware/injectSocietyId");
const { MODULES, PERMISSION_LEVELS } = require("../../common/constants");

const router = express.Router({ mergeParams: true });

router.use(authenticate);
router.use(injectSocietyId);

// ─── Resident: Create Booking ─────────────────────────────────────────────────
// MANAGE level required (residents have MANAGE on OWN scope per permission matrix)
router.post(
    "/",
    checkPermission(MODULES.AMENITY_BOOKING, PERMISSION_LEVELS.MANAGE),
    AmenityBookingController.createBooking
);

// ─── View Bookings (scoped by role internally in the service) ─────────────────
router.get(
    "/",
    checkPermission(MODULES.AMENITY_BOOKING, PERMISSION_LEVELS.VIEW),
    AmenityBookingController.getBookings
);

// ─── Cancel a Booking (residents own + admin) ─────────────────────────────────
router.post(
    "/:id/cancel",
    checkPermission(MODULES.AMENITY_BOOKING, PERMISSION_LEVELS.MANAGE),
    AmenityBookingController.cancelBooking
);

// ─── Admin: Approve / Reject ──────────────────────────────────────────────────
router.post(
    "/:id/approve",
    checkPermission(MODULES.AMENITY_BOOKING, PERMISSION_LEVELS.FULL),
    AmenityBookingController.approveBooking
);

router.post(
    "/:id/reject",
    checkPermission(MODULES.AMENITY_BOOKING, PERMISSION_LEVELS.FULL),
    AmenityBookingController.rejectBooking
);

module.exports = router;
