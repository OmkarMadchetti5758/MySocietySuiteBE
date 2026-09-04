"use strict";

const { body } = require("express-validator");
const { FESTIVAL_STATUS } = require("../../common/constants");

// Custom validator to check if start time is before end time
const checkTimeLogic = (value, { req }) => {
    const { startTime, endTime } = req.body;
    if (startTime && endTime) {
        if (startTime >= endTime) {
            throw new Error("Start time must be before end time");
        }
    }
    return true;
};

const createFestivalValidation = [
    body("title")
        .notEmpty().withMessage("Title is required")
        .isString().withMessage("Title must be a string")
        .trim()
        .isLength({ min: 3, max: 100 }).withMessage("Title must be between 3 and 100 characters"),
    body("description")
        .optional()
        .isString()
        .trim()
        .isLength({ max: 2000 }).withMessage("Description cannot exceed 2000 characters"),
    body("date")
        .notEmpty().withMessage("Date is required")
        .isISO8601().withMessage("Invalid date format"),
    body("startTime")
        .notEmpty().withMessage("Start time is required")
        .matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage("Start time must be in HH:mm format"),
    body("endTime")
        .notEmpty().withMessage("End time is required")
        .matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage("End time must be in HH:mm format")
        .custom(checkTimeLogic),
    body("venue")
        .notEmpty().withMessage("Venue is required")
        .isString()
        .trim()
        .isLength({ min: 2, max: 200 }).withMessage("Venue must be between 2 and 200 characters"),
    body("image")
        .optional()
        .isString()
        .trim(),
];

const updateFestivalValidation = [
    body("title")
        .optional()
        .notEmpty().withMessage("Title cannot be empty if provided")
        .isString()
        .trim()
        .isLength({ min: 3, max: 100 }).withMessage("Title must be between 3 and 100 characters"),
    body("description")
        .optional()
        .isString()
        .trim()
        .isLength({ max: 2000 }).withMessage("Description cannot exceed 2000 characters"),
    body("date")
        .optional()
        .isISO8601().withMessage("Invalid date format"),
    body("startTime")
        .optional()
        .matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage("Start time must be in HH:mm format"),
    body("endTime")
        .optional()
        .matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage("End time must be in HH:mm format"),
    body("venue")
        .optional()
        .notEmpty().withMessage("Venue cannot be empty if provided")
        .isString()
        .trim()
        .isLength({ min: 2, max: 200 }).withMessage("Venue must be between 2 and 200 characters"),
    body("image")
        .optional()
        .isString()
        .trim(),
    body("status")
        .optional()
        .isIn(Object.values(FESTIVAL_STATUS)).withMessage("Invalid status value"),
    // If both start and end time are updated, check logic
    body().custom((value, { req }) => {
        if (req.body.startTime && req.body.endTime) {
            if (req.body.startTime >= req.body.endTime) {
                throw new Error("Start time must be before end time");
            }
        }
        return true;
    }),
];

module.exports = {
    createFestivalValidation,
    updateFestivalValidation,
};
