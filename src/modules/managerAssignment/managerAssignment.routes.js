"use strict";

const express    = require("express");
const Controller = require("./managerAssignment.controller");
const authenticate = require("../../middleware/authenticate");
const authorize    = require("../../middleware/authorize");

const router = express.Router({ mergeParams: true });

const guard = [authenticate, authorize("admin", "committee_member")];

/**
 * Manager Assignment Routes — /api/v1/societies/:societyId/managers
 *
 * All routes require valid JWT + admin/committee_member role.
 * Business-rule guards (single-holder, duplicate, validation) are in the service.
 */

// GET  /societies/:societyId/managers?department=&status=&search=
router.get("/", guard, Controller.listManagers.bind(Controller));

// GET  /societies/:societyId/managers/residents-search?q=
router.get("/residents-search", guard, Controller.searchResidents.bind(Controller));

// POST /societies/:societyId/managers/assign   — Path A: existing resident
router.post("/assign", guard, Controller.assignExistingResident.bind(Controller));

// POST /societies/:societyId/managers/invite   — Path B: new user
router.post("/invite", guard, Controller.inviteNewManager.bind(Controller));

// PATCH /societies/:societyId/managers/:id/deactivate
router.patch("/:id/deactivate", guard, Controller.deactivateManager.bind(Controller));

// POST /societies/:societyId/managers/:id/resend-invite
router.post("/:id/resend-invite", guard, Controller.resendInvite.bind(Controller));

module.exports = router;
