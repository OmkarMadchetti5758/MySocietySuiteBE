"use strict";

const express = require("express");
const router = express.Router();
const controller = require("./dashboard.controller");
const authenticate = require("../../middleware/authenticate");
const injectSocietyId = require("../../middleware/injectSocietyId");

router.use(authenticate, injectSocietyId);

/**
 * GET /api/v1/dashboard/admin
 * Returns dynamic stats for the Admin Dashboard
 */
router.get("/admin", controller.getAdminDashboard);

/**
 * GET /api/v1/dashboard/resident
 * Returns dynamic stats for the Resident Dashboard
 */
router.get("/resident", controller.getResidentDashboard);

module.exports = router;

