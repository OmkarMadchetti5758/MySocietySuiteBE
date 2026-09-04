"use strict";

const express          = require("express");
const router           = express.Router();
const controller       = require("./parking.controller");
const authenticate     = require("../../middleware/authenticate");
const injectSocietyId  = require("../../middleware/injectSocietyId");
const checkPermission  = require("../../middleware/checkPermission");
const authorize        = require("../../middleware/authorize");
const upload           = require("../../middleware/upload.middleware");

const { MODULES, PERMISSION_LEVELS, ROLES } = require("../../common/constants");

// All parking routes require authentication + society scoping
router.use(authenticate, injectSocietyId);

// ── Parking Dashboard ──────────────────────────────────────────────────────────

/**
 * GET /parking/dashboard/stats
 * Server-side aggregated stats. All roles with VIEW access.
 */
router.get(
    "/dashboard/stats",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    controller.getDashboardStats
);

// ── Parking History ────────────────────────────────────────────────────────────

/**
 * GET /parking/history
 * Residents see own history; admins see all.
 */
router.get(
    "/history",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    controller.getHistory
);

// ── Parking Slots ──────────────────────────────────────────────────────────────

/**
 * POST /parking/slots — Admin: create new slot
 */
router.post(
    "/slots",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.FULL),
    controller.createSlot
);

/**
 * GET /parking/slots — All: list slots (residents see all in their society for info)
 */
router.get(
    "/slots",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    controller.listSlots
);

/**
 * GET /parking/slots/:id — All: get single slot
 */
router.get(
    "/slots/:id",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    controller.getSlotById
);

/**
 * PATCH /parking/slots/:id — Admin: update slot details
 */
router.patch(
    "/slots/:id",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.FULL),
    controller.updateSlot
);

/**
 * POST /parking/slots/:id/activate — Admin: activate slot
 */
router.post(
    "/slots/:id/activate",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.FULL),
    controller.activateSlot
);

/**
 * POST /parking/slots/:id/deactivate — Admin: deactivate slot
 */
router.post(
    "/slots/:id/deactivate",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.FULL),
    controller.deactivateSlot
);

// ── Vehicles ───────────────────────────────────────────────────────────────────

/**
 * POST /parking/vehicles
 * Residents register their own vehicle. Admins can register for any resident.
 */
router.post(
    "/vehicles",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    controller.registerVehicle
);

/**
 * GET /parking/vehicles — List vehicles (scoped by role in service)
 */
router.get(
    "/vehicles",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    controller.listVehicles
);

/**
 * GET /parking/vehicles/:id
 */
router.get(
    "/vehicles/:id",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    controller.getVehicleById
);

/**
 * PATCH /parking/vehicles/:id — Owner or Admin can update
 */
router.patch(
    "/vehicles/:id",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    controller.updateVehicle
);

/**
 * POST /parking/vehicles/:id/deactivate
 */
router.post(
    "/vehicles/:id/deactivate",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    controller.deactivateVehicle
);

// ── Parking Assignments ────────────────────────────────────────────────────────

/**
 * POST /parking/assignments — Admin only: allocate slot
 */
router.post(
    "/assignments",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.FULL),
    controller.allocateParking
);

/**
 * GET /parking/assignments — All: list (scoped in service)
 */
router.get(
    "/assignments",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    controller.listAssignments
);

/**
 * GET /parking/assignments/:id
 */
router.get(
    "/assignments/:id",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    controller.getAssignmentById
);

/**
 * POST /parking/assignments/:id/release — Admin: release slot
 */
router.post(
    "/assignments/:id/release",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.FULL),
    controller.releaseParking
);

/**
 * POST /parking/assignments/:id/reassign — Admin: reassign slot
 */
router.post(
    "/assignments/:id/reassign",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.FULL),
    controller.reassignParking
);

// ── Parking Requests ───────────────────────────────────────────────────────────

/**
 * POST /parking/requests — Residents: submit parking request
 */
router.post(
    "/requests",
    authorize(ROLES.RESIDENT_OWNER, ROLES.RESIDENT_TENANT, ROLES.RESIDENT),
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    controller.createRequest
);

/**
 * GET /parking/requests — Residents: own; Admin: all
 */
router.get(
    "/requests",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    controller.listRequests
);

/**
 * POST /parking/requests/:id/approve — Admin: approve (atomically allocates)
 */
router.post(
    "/requests/:id/approve",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.FULL),
    controller.approveRequest
);

/**
 * POST /parking/requests/:id/reject — Admin: reject
 */
router.post(
    "/requests/:id/reject",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.FULL),
    controller.rejectRequest
);

// ── Visitor Parking ────────────────────────────────────────────────────────────

/**
 * POST /parking/visitor — Admin/Guard: create visitor session
 */
router.post(
    "/visitor",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.MANAGE),
    controller.createVisitorSession
);

/**
 * GET /parking/visitor — View all visitor sessions
 */
router.get(
    "/visitor",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    controller.listVisitorSessions
);

/**
 * GET /parking/visitor/:id
 */
router.get(
    "/visitor/:id",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    controller.getVisitorSessionById
);

/**
 * POST /parking/visitor/:id/exit — Record visitor exit
 */
router.post(
    "/visitor/:id/exit",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.MANAGE),
    controller.exitVisitor
);

// ── Parking Violations ─────────────────────────────────────────────────────────

/**
 * POST /parking/violations — Admin/Guard: record violation. Supports image uploads.
 */
router.post(
    "/violations",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.MANAGE),
    upload.array("evidence", 5),
    controller.createViolation
);

/**
 * GET /parking/violations — List violations
 */
router.get(
    "/violations",
    checkPermission(MODULES.PARKING_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    controller.listViolations
);

module.exports = router;
