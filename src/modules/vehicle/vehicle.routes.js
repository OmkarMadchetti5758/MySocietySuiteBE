"use strict";

const express = require("express");
const VehicleController = require("./vehicle.controller");
const authenticate = require("../../middleware/authenticate");

const router = express.Router();
router.use(authenticate);

router.get("/lookup/:regNumber", VehicleController.lookupVehicle);

module.exports = router;
