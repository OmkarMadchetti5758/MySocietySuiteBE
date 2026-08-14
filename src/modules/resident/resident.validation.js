"use strict";

const { body } = require("express-validator");
const { ROLES, RESIDENT_TYPE } = require("../../common/constants");

const createResidentValidation = [
    body("name").notEmpty().withMessage("Name is required").trim(),
    body("email").isEmail().withMessage("Valid email is required").normalizeEmail(),
    body("phone").notEmpty().withMessage("Phone number is required").trim(),
    body("flatNumber").notEmpty().withMessage("Flat number is required").trim(),
    body("wingCode").optional().trim(),
    body("residentType")
        .optional()
        .isIn(Object.values(RESIDENT_TYPE))
        .withMessage("Invalid resident type"),
    body("role")
        .optional()
        .isIn([ROLES.RESIDENT_OWNER, ROLES.RESIDENT_TENANT])
        .withMessage("Invalid role"),
];

module.exports = { createResidentValidation };
