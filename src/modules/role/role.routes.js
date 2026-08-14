"use strict";

const express        = require("express");
const RoleController = require("./role.controller");
const authenticate   = require("../../middleware/authenticate");
const authorize      = require("../../middleware/authorize");

const router = express.Router({ mergeParams: true }); // mergeParams: inherit :societyId from parent

/**
 * Role Routes — /api/v1/societies/:societyId/roles
 *
 * All routes require:
 *  - authenticate: valid JWT
 *  - authorize(['admin']): only Committee/Society Admin can manage roles
 *
 * Additional business-rule guards (isEditable, hard-block, self-elevation)
 * are enforced in role.service.js, not here.
 */

const guard = [authenticate, authorize("admin", "committee_member")];

/**
 * @route  GET /api/v1/societies/:societyId/roles
 * @desc   List all society-level roles (merged: override if exists, else GLOBAL)
 */
router.get("/", guard, RoleController.listRoles.bind(RoleController));

/**
 * @route  GET /api/v1/societies/:societyId/roles/:roleKey
 * @desc   Get full permission map for a specific role
 */
router.get("/:roleKey", guard, RoleController.getRole.bind(RoleController));

/**
 * @route  PATCH /api/v1/societies/:societyId/roles/:roleKey
 * @desc   Partially update permissions for a role (diff-based, not full overwrite)
 * @body   { permissions: { moduleKey: { enabled, access } } }
 */
router.patch("/:roleKey", guard, RoleController.patchRole.bind(RoleController));

/**
 * @route  POST /api/v1/societies/:societyId/roles/:roleKey/reset
 * @desc   Reset role to GLOBAL default (deletes society-specific override)
 */
router.post("/:roleKey/reset", guard, RoleController.resetRole.bind(RoleController));

module.exports = router;
