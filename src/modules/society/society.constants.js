"use strict";

const SOCIETY_ERRORS = Object.freeze({
    SOCIETY_EXISTS: "Society with this name already exists.",
    DATABASE_NAME_TAKEN: "Database name is already taken.",
    IDENTIFIER_TAKEN: "Admin email or mobile is already linked to an existing society.",
});

module.exports = {
    SOCIETY_ERRORS,
};
