"use strict";

const RESIDENT_ERRORS = Object.freeze({
    NOT_FOUND: "Resident not found",
    EMAIL_EXISTS: "A user with this email already exists in this society",
    MOBILE_EXISTS: "A user with this mobile number already exists in this society",
    IDENTIFIER_TAKEN: "This email or phone number is already registered on the platform",
    FLAT_REQUIRED: "Flat number is required",
});

module.exports = { RESIDENT_ERRORS };
