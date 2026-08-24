"use strict";

const express = require("express");
const { markAttendance, getAttendance, getMonthlyReport, getSummary } = require("../controllers/attendance.controller");
const authenticate = require("../middleware/authenticate");
const injectSocietyId = require("../middleware/injectSocietyId");
const checkPermission = require("../middleware/checkPermission");
const { MODULES, PERMISSION_LEVELS } = require("../common/constants");

const router = express.Router();

router.use(authenticate, injectSocietyId);

// Summary counts (present / absent / on-leave) for stat cards
router.get(
    "/summary",
    checkPermission(MODULES.STAFF_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    getSummary
);

// Marking attendance requires MANAGE; reading requires VIEW
router.route("/")
    .get(checkPermission(MODULES.STAFF_MANAGEMENT, PERMISSION_LEVELS.VIEW), getAttendance)
    .post(checkPermission(MODULES.STAFF_MANAGEMENT, PERMISSION_LEVELS.MANAGE), markAttendance);

router.get(
    "/report",
    checkPermission(MODULES.STAFF_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    getMonthlyReport
);

module.exports = router;
