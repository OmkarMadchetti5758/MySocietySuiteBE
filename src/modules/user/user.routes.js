"use strict";

const express = require("express");
const UserController = require("./user.controller");
const validate = require("../../middleware/validate");
const authenticate = require("../../middleware/authenticate");
const injectSocietyId = require("../../middleware/injectSocietyId");
const checkPermission = require("../../middleware/checkPermission");
const { MODULES, PERMISSION_LEVELS } = require("../../common/constants");
const {
    createUserValidation,
    updateUserValidation,
    userIdValidation,
    roleKeyValidation,
    roleKeyParamValidation,
} = require("./user.validation");

const router = express.Router();

// All routes require authentication and society scoping
router.use(authenticate, injectSocietyId);

// List users
router.get(
    "/",
    checkPermission(MODULES.STAFF_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    UserController.getUsers
);

// Create user
router.post(
    "/",
    checkPermission(MODULES.STAFF_MANAGEMENT, PERMISSION_LEVELS.FULL),
    createUserValidation,
    validate,
    UserController.createUser
);

// Get single user
router.get(
    "/:id",
    checkPermission(MODULES.STAFF_MANAGEMENT, PERMISSION_LEVELS.VIEW),
    userIdValidation,
    validate,
    UserController.getUser
);

// Update user
router.patch(
    "/:id",
    checkPermission(MODULES.STAFF_MANAGEMENT, PERMISSION_LEVELS.FULL),
    updateUserValidation,
    validate,
    UserController.updateUser
);

// Delete user
router.delete(
    "/:id",
    checkPermission(MODULES.STAFF_MANAGEMENT, PERMISSION_LEVELS.FULL),
    userIdValidation,
    validate,
    UserController.deleteUser
);

// Assign additional role (dual-role users)
router.post(
    "/:id/roles",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.FULL),
    roleKeyValidation,
    validate,
    UserController.addUserRole
);

// Remove secondary role
router.delete(
    "/:id/roles/:roleKey",
    checkPermission(MODULES.SOCIETY_FLAT_SETUP, PERMISSION_LEVELS.FULL),
    roleKeyParamValidation,
    validate,
    UserController.removeUserRole
);

module.exports = router;
