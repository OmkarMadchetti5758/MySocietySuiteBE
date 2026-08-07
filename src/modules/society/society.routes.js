"use strict";

const express = require("express");
const SocietyController = require("./society.controller");
const { registerSocietyValidation } = require("./society.validation");
const validate = require("../../middleware/validate");

const router = express.Router();

/**
 * @route   GET /api/v1/societies/active
 * @desc    Get all active societies for dropdowns
 * @access  Public
 */
router.get("/active", SocietyController.getActiveSocieties.bind(SocietyController));

/**
 * @route   POST /api/v1/societies/register
 * @desc    Register a new society and provision its tenant database + admin user
 * @access  Public (can be restricted to SUPER_ADMIN later)
 */
router.post(
    "/register",
    registerSocietyValidation,
    validate,
    SocietyController.registerSociety.bind(SocietyController)
);

module.exports = router;
