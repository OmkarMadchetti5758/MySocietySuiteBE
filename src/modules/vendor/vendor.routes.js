"use strict";

const express = require("express");
const vendorController = require("./vendor.controller");
const authenticate = require("../../middleware/authenticate");
const injectSocietyId = require("../../middleware/injectSocietyId");
const checkPermission = require("../../middleware/checkPermission");
const { MODULES, PERMISSION_LEVELS, ROLES } = require("../../common/constants");
const authorize = require("../../middleware/authorize");

const router = express.Router();

// All routes require authentication
router.use(authenticate, injectSocietyId);

// ── Vendor Portal Routes (VENDOR role only) ───────────────────────────────────
// The controller resolves vendorId from req.user.id (User linked to Vendor)
router.get(
    "/me/tasks",
    authorize(ROLES.VENDOR),
    checkPermission(MODULES.COMPLAINTS_HELPDESK, PERMISSION_LEVELS.VIEW),
    vendorController.getVendorTasks
);

router.get(
    "/me/tasks/:taskId",
    authorize(ROLES.VENDOR),
    checkPermission(MODULES.COMPLAINTS_HELPDESK, PERMISSION_LEVELS.VIEW),
    vendorController.getVendorTaskById
);

router.patch(
    "/me/tasks/:taskId",
    authorize(ROLES.VENDOR),
    checkPermission(MODULES.COMPLAINTS_HELPDESK, PERMISSION_LEVELS.MANAGE),
    vendorController.updateVendorTask
);

// ── Admin / Facility Manager Routes ──────────────────────────────────────────
router.post(
    "/",
    authorize(ROLES.ADMIN),
    checkPermission(MODULES.VENDOR_MANAGEMENT, PERMISSION_LEVELS.FULL),
    vendorController.createVendor
);

router.get(
    "/",
    checkPermission(MODULES.VENDOR_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    vendorController.getVendors
);

// ── Task Assignment Routes ────────────────────────────────────────────────────
// IMPORTANT: These must be declared BEFORE /:id to prevent Express from
// treating "tasks" as the :id wildcard parameter.
router.get(
    "/tasks",
    checkPermission(MODULES.COMPLAINTS_HELPDESK, PERMISSION_LEVELS.VIEW),
    vendorController.getAllTasks
);

router.post(
    "/tasks/:taskId/assign-vendor",
    checkPermission(MODULES.COMPLAINTS_HELPDESK, PERMISSION_LEVELS.MANAGE),
    vendorController.assignTask
);

router.patch(
    "/tasks/:taskId/reassign-vendor",
    checkPermission(MODULES.COMPLAINTS_HELPDESK, PERMISSION_LEVELS.MANAGE),
    vendorController.reassignTask
);

// ── Vendor CRUD Routes (wildcard :id must come last) ─────────────────────────
router.get(
    "/:id",
    checkPermission(MODULES.VENDOR_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    vendorController.getVendorById
);

router.patch(
    "/:id",
    checkPermission(MODULES.VENDOR_MANAGEMENT, PERMISSION_LEVELS.MANAGE),
    vendorController.updateVendor
);

router.get(
    "/:id/history",
    checkPermission(MODULES.VENDOR_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    vendorController.getVendorHistory
);

module.exports = router;
