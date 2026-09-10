"use strict";

const express = require("express");
const SocietyController = require("./society.controller");
const { registerSocietyValidation } = require("./society.validation");
const validate = require("../../middleware/validate");
const authenticate = require("../../middleware/authenticate");
const injectSocietyId = require("../../middleware/injectSocietyId");
const checkPermission = require("../../middleware/checkPermission");
const upload = require("../../middleware/upload.middleware");
const AppError = require("../../common/AppError");
const { MODULES, PERMISSION_LEVELS } = require("../../common/constants");

const router = express.Router();

router.get("/active", SocietyController.getActiveSocieties.bind(SocietyController));

router.post(
    "/register",
    authenticate,
    (req, res, next) => {
        if (req.user.role !== "super_admin") {
            return next(new AppError(
                "Society onboarding is restricted to MSquare Super Admins. Contact support to register your society.",
                403
            ));
        }
        next();
    },
    registerSocietyValidation,
    validate,
    SocietyController.registerSociety.bind(SocietyController)
);

router.get(
    "/current",
    authenticate,
    injectSocietyId,
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    SocietyController.getCurrentSociety.bind(SocietyController)
);

router.put(
    "/current",
    authenticate,
    injectSocietyId,
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.FULL),
    upload.single("logo"),
    SocietyController.updateCurrentSociety.bind(SocietyController)
);

module.exports = router;
