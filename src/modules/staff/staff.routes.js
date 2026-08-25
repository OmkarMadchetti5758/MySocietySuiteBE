"use strict";

const express = require("express");
const { addStaff, getAllStaff, getShiftAndGateView } = require("./staff.controller");
const authenticate = require("../../middleware/authenticate");
const injectSocietyId = require("../../middleware/injectSocietyId");
const checkPermission = require("../../middleware/checkPermission");
const { MODULES, PERMISSION_LEVELS } = require("../../common/constants");

const router = express.Router();

router.use(authenticate, injectSocietyId);

router.route("/")
    .get(checkPermission(MODULES.STAFF_MANAGEMENT, PERMISSION_LEVELS.VIEW), getAllStaff)
    .post(checkPermission(MODULES.STAFF_MANAGEMENT, PERMISSION_LEVELS.FULL), addStaff);

router.get(
    "/shift-view",
    checkPermission(MODULES.STAFF_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    getShiftAndGateView
);

module.exports = router;
