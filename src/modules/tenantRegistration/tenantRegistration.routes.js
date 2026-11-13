"use strict";

const express = require("express");
const router = express.Router();

const TenantRegistrationController = require("./tenantRegistration.controller");
const authenticate = require("../../middleware/authenticate");
const injectSocietyId = require("../../middleware/injectSocietyId");
const checkPermission = require("../../middleware/checkPermission");
const validate = require("../../middleware/validate");
const documentUpload = require("../../middleware/documentUpload.middleware");
const { MODULES, PERMISSION_LEVELS } = require("../../common/constants");
const {
    createTenantValidation,
    updateStatusValidation,
    updateTenantValidation,
} = require("./tenantRegistration.validation");

// All routes require authentication + society scope
router.use(authenticate, injectSocietyId);

// GET /eligible-flats — owner fetches their vacant flats
router.get(
    "/eligible-flats",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    TenantRegistrationController.getEligibleFlats
);

// GET /flats — owner fetches all their owned flats (for history selection)
router.get(
    "/flats",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    TenantRegistrationController.getOwnerFlats
);

// GET / — list tenant registrations (admin: all; owner: own)
router.get(
    "/",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    TenantRegistrationController.getTenants
);

// POST / — register a new tenant (owner action, with file uploads)
router.post(
    "/",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    documentUpload.fields([
        { name: "identityProof", maxCount: 1 },
        { name: "rentalAgreement", maxCount: 1 },
        { name: "optionalDocs", maxCount: 5 },
    ]),
    createTenantValidation,
    validate,
    TenantRegistrationController.registerTenant
);

// GET /history/:flatId — tenancy history for a flat
router.get(
    "/history/:flatId",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    TenantRegistrationController.getTenantHistory
);

// GET /:id — single registration
router.get(
    "/:id",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    TenantRegistrationController.getTenantById
);

// PUT /:id — update tenant registration details
router.put(
    "/:id",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    updateTenantValidation,
    validate,
    TenantRegistrationController.updateTenant
);

// PUT /:id/status — change status (Active / Inactive / Vacated)
router.put(
    "/:id/status",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    updateStatusValidation,
    validate,
    TenantRegistrationController.changeStatus
);

// POST /:id/resend-invite — resend invite email to tenant
router.post(
    "/:id/resend-invite",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.VIEW),
    TenantRegistrationController.resendInvite
);

module.exports = router;
