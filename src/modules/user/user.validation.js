"use strict";

const { body, param } = require("express-validator");
const { ROLES } = require("../../common/constants");

const createUserValidation = [
    body("name").notEmpty().withMessage("Name is required").trim(),
    body("mobile").notEmpty().withMessage("Mobile is required").trim(),
    body("email").optional().isEmail().withMessage("Invalid email address"),
    body("password").notEmpty().isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
    body("role").optional().isIn(Object.values(ROLES)).withMessage("Invalid role"),
];

const updateUserValidation = [
    param("id").isMongoId().withMessage("Invalid user ID"),
    body("name").optional().notEmpty().trim(),
    body("mobile").optional().notEmpty().trim(),
    body("email").optional().isEmail().withMessage("Invalid email address"),
    body("isActive").optional().isBoolean(),
];

const userIdValidation = [
    param("id").isMongoId().withMessage("Invalid user ID"),
];

module.exports = {
    createUserValidation,
    updateUserValidation,
    userIdValidation,
};
