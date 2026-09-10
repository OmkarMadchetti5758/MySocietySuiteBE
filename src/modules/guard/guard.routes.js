"use strict";

const express = require("express");
const GuardController = require("./guard.controller");
const authenticate = require("../../middleware/authenticate");

const router = express.Router();

router.use(authenticate);

// Gate allocation
router.get("/my-gate", GuardController.getMyAssignedGate);

module.exports = router;
