"use strict";

const express    = require("express");
const router     = express.Router();

const controller       = require("./complaint.controller");
const authenticate     = require("../../middleware/authenticate");
const injectSocietyId  = require("../../middleware/injectSocietyId");
const checkPermission  = require("../../middleware/checkPermission");
const authorize        = require("../../middleware/authorize");
const upload           = require("../../middleware/upload.middleware");

const { MODULES, PERMISSION_LEVELS, ROLES } = require("../../common/constants");

// All complaint routes require authentication + society scoping
router.use(authenticate, injectSocietyId);

// ── Utility Routes (must come BEFORE wildcard :id routes) ─────────────────────

/**
 * GET /complaints/categories
 * Anyone with helpdesk access can list categories.
 */
router.get(
    "/categories",
    checkPermission(MODULES.COMPLAINTS_HELPDESK, PERMISSION_LEVELS.VIEW),
    controller.getCategories
);

/**
 * GET /complaints/summary
 * Committee Admin and Facility Manager reporting.
 */
router.get(
    "/summary",
    checkPermission(MODULES.COMPLAINTS_HELPDESK, PERMISSION_LEVELS.MANAGE),
    controller.getComplaintSummary
);

// ── Vendor Portal Routes ───────────────────────────────────────────────────────
// Must come BEFORE /:id to avoid Express treating "vendor" as the :id param.

/**
 * GET /complaints/vendor/assigned
 * Vendor sees only their own assigned complaints.
 */
router.get(
    "/vendor/assigned",
    authorize(ROLES.VENDOR),
    checkPermission(MODULES.COMPLAINTS_HELPDESK, PERMISSION_LEVELS.VIEW),
    controller.getVendorAssignedComplaints
);

/**
 * GET /complaints/vendor/:id
 * Vendor gets a single complaint — double ownership enforced in service.
 */
router.get(
    "/vendor/:id",
    authorize(ROLES.VENDOR),
    checkPermission(MODULES.COMPLAINTS_HELPDESK, PERMISSION_LEVELS.VIEW),
    controller.getVendorComplaintById
);

/**
 * PATCH /complaints/vendor/:id/status
 * Vendor updates complaint status (restricted to OPEN→IN_PROGRESS, IN_PROGRESS→RESOLVED).
 */
router.patch(
    "/vendor/:id/status",
    authorize(ROLES.VENDOR),
    checkPermission(MODULES.COMPLAINTS_HELPDESK, PERMISSION_LEVELS.MANAGE),
    controller.vendorUpdateStatus
);

// ── Resident Routes ───────────────────────────────────────────────────────────

/**
 * POST /complaints
 * Resident creates a new complaint. Accepts optional image attachment.
 */
router.post(
    "/",
    authorize(ROLES.RESIDENT_OWNER, ROLES.RESIDENT_TENANT, ROLES.RESIDENT),
    checkPermission(MODULES.COMPLAINTS_HELPDESK, PERMISSION_LEVELS.MANAGE),
    upload.array("attachments", 3), // Up to 3 images
    controller.createComplaint
);

/**
 * GET /complaints/resident-info
 * Fetch basic resident info (email, flat, wing) for raising tickets.
 */
router.get(
    "/resident-info",
    authorize(ROLES.RESIDENT_OWNER, ROLES.RESIDENT_TENANT, ROLES.RESIDENT),
    checkPermission(MODULES.COMPLAINTS_HELPDESK, PERMISSION_LEVELS.MANAGE),
    controller.getResidentInfo
);

/**
 * PATCH /complaints/:id/confirm-resolution
 * Resident confirms resolution → CLOSED.
 */
router.patch(
    "/:id/confirm-resolution",
    authorize(ROLES.RESIDENT_OWNER, ROLES.RESIDENT_TENANT, ROLES.RESIDENT),
    checkPermission(MODULES.COMPLAINTS_HELPDESK, PERMISSION_LEVELS.MANAGE),
    controller.confirmResolution
);

/**
 * PATCH /complaints/:id/reopen
 * Resident reopens a RESOLVED complaint (unsatisfied).
 */
router.patch(
    "/:id/reopen",
    authorize(ROLES.RESIDENT_OWNER, ROLES.RESIDENT_TENANT, ROLES.RESIDENT),
    checkPermission(MODULES.COMPLAINTS_HELPDESK, PERMISSION_LEVELS.MANAGE),
    controller.reopenComplaint
);

// ── Admin / Facility Manager Routes ───────────────────────────────────────────

/**
 * PATCH /complaints/:id/assign
 * Assign or reassign complaint to staff or vendor.
 */
router.patch(
    "/:id/assign",
    checkPermission(MODULES.COMPLAINTS_HELPDESK, PERMISSION_LEVELS.MANAGE),
    controller.assignComplaint
);

/**
 * PATCH /complaints/:id/status
 * Admin can update status directly (exceptional cases / overrides).
 */
router.patch(
    "/:id/status",
    checkPermission(MODULES.COMPLAINTS_HELPDESK, PERMISSION_LEVELS.MANAGE),
    controller.updateComplaintStatus
);

/**
 * GET /complaints/:id/history
 * Full audit history — Admin and Facility Manager only.
 */
router.get(
    "/:id/history",
    checkPermission(MODULES.COMPLAINTS_HELPDESK, PERMISSION_LEVELS.MANAGE),
    controller.getComplaintHistory
);

// ── Shared Routes (both resident and admin, scoped differently in controller) ──

/**
 * GET /complaints
 * - Residents: their own complaints
 * - Admin/Manager: all society complaints (filterable)
 */
router.get(
    "/",
    checkPermission(MODULES.COMPLAINTS_HELPDESK, PERMISSION_LEVELS.VIEW),
    controller.listComplaints
);

/**
 * GET /complaints/:id
 * - Residents: own complaint only (enforced in service)
 * - Admin/Manager: any complaint in their society
 */
router.get(
    "/:id",
    checkPermission(MODULES.COMPLAINTS_HELPDESK, PERMISSION_LEVELS.VIEW),
    controller.getComplaintById
);

module.exports = router;
