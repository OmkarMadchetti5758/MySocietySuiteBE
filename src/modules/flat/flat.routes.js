"use strict";

const express = require("express");
const FlatController = require("./flat.controller");
const authenticate = require("../../middleware/authenticate");
const injectSocietyId = require("../../middleware/injectSocietyId");
const checkPermission = require("../../middleware/checkPermission");
const { MODULES, PERMISSION_LEVELS } = require("../../common/constants");

const router = express.Router();

router.use(authenticate, injectSocietyId);

router.get(
    "/",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    FlatController.getFlats.bind(FlatController)
);

router.post(
    "/",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.MANAGE),
    FlatController.createFlat.bind(FlatController)
);

router.get(
    "/:flatId",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    FlatController.getFlatById.bind(FlatController)
);

router.put(
    "/:flatId",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.MANAGE),
    FlatController.updateFlat.bind(FlatController)
);

router.post(
    "/:flatId/allocate",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.MANAGE),
    FlatController.allocateResident.bind(FlatController)
);

module.exports = router;
