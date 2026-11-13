"use strict";

const TENANT_ERRORS = Object.freeze({
    FLAT_NOT_FOUND: "Flat not found in this society",
    FLAT_NOT_OWNED: "You are not the primary owner of this flat",
    ACTIVE_TENANCY_EXISTS: "This flat already has an active tenant registration",
    IDENTITY_PROOF_REQUIRED: "Identity proof document is required",
    RENTAL_AGREEMENT_REQUIRED: "Rental agreement document is required",
    TENANT_NOT_FOUND: "Tenant registration not found",
    FORBIDDEN: "You do not have permission to access this tenant registration",
    FLAT_NOT_OWNED_BY_USER: "You are not the owner of this flat",
    INVALID_STATUS: "Invalid status value",
});

const TENANT_STATUS = Object.freeze({
    ACTIVE: "Active",
    INACTIVE: "Inactive",
    VACATED: "Vacated",
});

const TENANT_DOCUMENT_TYPES = Object.freeze({
    IDENTITY_PROOF: "identity_proof",
    RENTAL_AGREEMENT: "rental_agreement",
    OTHER: "other",
});

module.exports = { TENANT_ERRORS, TENANT_STATUS, TENANT_DOCUMENT_TYPES };
