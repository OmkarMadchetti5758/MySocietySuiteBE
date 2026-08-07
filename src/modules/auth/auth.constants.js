"use strict";

const AUTH_ERRORS = Object.freeze({
    INVALID_CREDENTIALS: "Invalid mobile/email or password.",
    SOCIETY_NOT_FOUND: "Society not found. Please check your credentials.",
    USER_NOT_FOUND: "User not found in the specified society.",
    USER_INACTIVE: "Your account is inactive. Please contact the society admin.",
    TOKEN_MISSING: "Refresh token is missing.",
    TOKEN_INVALID: "Invalid or expired refresh token.",
});

module.exports = {
    AUTH_ERRORS,
};
