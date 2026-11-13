"use strict";

const { body } = require("express-validator");

const MOBILE_REGEX = /^[6-9]\d{9}$/;

const createTenantValidation = [
    body("fullName")
        .notEmpty()
        .withMessage("Full name is required")
        .isString()
        .trim(),

    body("email")
        .notEmpty()
        .withMessage("Email is required")
        .isEmail()
        .withMessage("Please provide a valid email address"),

    body("mobileNumber")
        .notEmpty()
        .withMessage("Mobile number is required")
        .matches(MOBILE_REGEX)
        .withMessage("Please provide a valid 10-digit Indian mobile number"),

    body("flatId")
        .notEmpty()
        .withMessage("flatId is required")
        .isMongoId()
        .withMessage("flatId must be a valid MongoDB ObjectId"),

    body("moveInDate")
        .notEmpty()
        .withMessage("Move-in date is required")
        .isISO8601()
        .withMessage("moveInDate must be a valid ISO 8601 date"),

    body("monthlyRent")
        .optional({ values: "falsy" })
        .isNumeric()
        .withMessage("monthlyRent must be a number"),

    body("securityDeposit")
        .optional({ values: "falsy" })
        .isNumeric()
        .withMessage("securityDeposit must be a number"),

    body("rentDueDay")
        .optional({ values: "falsy" })
        .isInt({ min: 1, max: 28 })
        .withMessage("rentDueDay must be an integer between 1 and 28"),

    body("numberOfOccupants")
        .optional({ values: "falsy" })
        .isInt({ min: 1 })
        .withMessage("numberOfOccupants must be a positive integer"),

    body("referenceContactNumber")
        .optional({ values: "falsy" })
        .custom((value) => {
            if (value && !MOBILE_REGEX.test(value)) {
                throw new Error("referenceContactNumber must be a valid 10-digit Indian mobile number");
            }
            return true;
        }),

    body("moveOutDate")
        .optional({ values: "falsy" })
        .isISO8601()
        .withMessage("moveOutDate must be a valid ISO 8601 date"),

    body("dateOfBirth")
        .optional({ values: "falsy" })
        .isISO8601()
        .withMessage("dateOfBirth must be a valid ISO 8601 date"),

    body("gender")
        .optional({ values: "falsy" })
        .isIn(["Male", "Female", "Other"])
        .withMessage("gender must be one of: Male, Female, Other"),

    body("employmentType")
        .optional({ values: "falsy" })
        .isIn(["Salaried", "Self Employed"])
        .withMessage("employmentType must be one of: Salaried, Self Employed"),

    body("referenceRelation")
        .optional({ values: "falsy" })
        .isIn(["Friend", "Relative", "Colleague", "Neighbour", "Other"])
        .withMessage("referenceRelation must be one of: Friend, Relative, Colleague, Neighbour, Other"),
];

const updateStatusValidation = [
    body("status")
        .notEmpty()
        .withMessage("status is required")
        .isIn(["Active", "Inactive", "Vacated"])
        .withMessage("status must be one of: Active, Inactive, Vacated"),
];

const updateTenantValidation = [
    body("fullName")
        .optional({ values: "falsy" })
        .isString()
        .trim(),

    body("email")
        .optional({ values: "falsy" })
        .isEmail()
        .withMessage("Please provide a valid email address"),

    body("mobileNumber")
        .optional({ values: "falsy" })
        .matches(MOBILE_REGEX)
        .withMessage("Please provide a valid 10-digit Indian mobile number"),

    body("moveInDate")
        .optional({ values: "falsy" })
        .isISO8601()
        .withMessage("moveInDate must be a valid ISO 8601 date"),

    body("monthlyRent")
        .optional({ values: "falsy" })
        .isNumeric()
        .withMessage("monthlyRent must be a number"),

    body("securityDeposit")
        .optional({ values: "falsy" })
        .isNumeric()
        .withMessage("securityDeposit must be a number"),

    body("rentDueDay")
        .optional({ values: "falsy" })
        .isInt({ min: 1, max: 28 })
        .withMessage("rentDueDay must be an integer between 1 and 28"),

    body("numberOfOccupants")
        .optional({ values: "falsy" })
        .isInt({ min: 1 })
        .withMessage("numberOfOccupants must be a positive integer"),

    body("referenceContactNumber")
        .optional({ values: "falsy" })
        .custom((value) => {
            if (value && !MOBILE_REGEX.test(value)) {
                throw new Error("referenceContactNumber must be a valid 10-digit Indian mobile number");
            }
            return true;
        }),

    body("moveOutDate")
        .optional({ values: "falsy" })
        .isISO8601()
        .withMessage("moveOutDate must be a valid ISO 8601 date"),

    body("dateOfBirth")
        .optional({ values: "falsy" })
        .isISO8601()
        .withMessage("dateOfBirth must be a valid ISO 8601 date"),

    body("gender")
        .optional({ values: "falsy" })
        .isIn(["Male", "Female", "Other"])
        .withMessage("gender must be one of: Male, Female, Other"),

    body("employmentType")
        .optional({ values: "falsy" })
        .isIn(["Salaried", "Self Employed"])
        .withMessage("employmentType must be one of: Salaried, Self Employed"),

    body("referenceRelation")
        .optional({ values: "falsy" })
        .isIn(["Friend", "Relative", "Colleague", "Neighbour", "Other"])
        .withMessage("referenceRelation must be one of: Friend, Relative, Colleague, Neighbour, Other"),
];

module.exports = { createTenantValidation, updateStatusValidation, updateTenantValidation };
