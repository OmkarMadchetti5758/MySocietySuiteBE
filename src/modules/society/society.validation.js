"use strict";

const { body } = require("express-validator");

const registerSocietyValidation = [
    body("societyName")
        .notEmpty().withMessage("Society name is required")
        .trim(),
    body("adminName")
        .notEmpty().withMessage("Admin name is required")
        .trim(),
    body("adminEmail")
        .optional({ checkFalsy: true })
        .isEmail().withMessage("Invalid email format")
        .normalizeEmail(),
    body("adminMobile")
        .optional({ checkFalsy: true })
        .matches(/^[0-9]{10}$/).withMessage("Mobile number must be 10 digits"),
    body().custom((_, { req }) => {
        const { adminEmail, adminMobile } = req.body;
        if (!adminEmail && !adminMobile) {
            throw new Error("Either admin email or admin mobile is required");
        }
        return true;
    }),
    body("adminPassword")
        .notEmpty().withMessage("Admin password is required")
        .isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
    body("address.street").optional().trim(),
    body("address.city").optional().trim(),
    body("address.state").optional().trim(),
    body("address.zipCode").optional().trim(),
    body("address.country").optional().trim()
];

module.exports = {
    registerSocietyValidation
};
