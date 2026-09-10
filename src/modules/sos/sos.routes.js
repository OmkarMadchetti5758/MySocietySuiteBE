"use strict";

const express = require("express");
const SosController = require("./sos.controller");
const authenticate = require("../../middleware/authenticate");

const router = express.Router();
router.use(authenticate);

router.post("/trigger", SosController.triggerSos);
router.patch("/:id/acknowledge", SosController.acknowledgeSos);
router.patch("/:id/resolve", SosController.resolveSos);

module.exports = router;
