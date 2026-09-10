"use strict";

const express        = require("express");
const RoleController = require("./role.controller");
const authenticate   = require("../../middleware/authenticate");
const authorize      = require("../../middleware/authorize");

const router = express.Router({ mergeParams: true }); // mergeParams: inherit :societyId from parent



const guard = [authenticate, authorize("admin", "committee_member")];

router.get("/", guard, RoleController.listRoles.bind(RoleController));

router.get("/:roleKey", guard, RoleController.getRole.bind(RoleController));

router.patch("/:roleKey", guard, RoleController.patchRole.bind(RoleController));

router.post("/:roleKey/reset", guard, RoleController.resetRole.bind(RoleController));

module.exports = router;
