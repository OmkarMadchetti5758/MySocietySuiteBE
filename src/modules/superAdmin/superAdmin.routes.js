"use strict";

const express = require("express");
const SuperAdminController = require("./superAdmin.controller");
const authenticate = require("../../middleware/authenticate");

const router = express.Router();

// All super admin routes must be authenticated and restricted to super_admin role
router.use(authenticate);

// We can add a simple middleware here to verify super admin role
const requireSuperAdmin = (req, res, next) => {
    if (req.user.role !== "super_admin") {
        return res.status(403).json({
            status: "error",
            message: "Forbidden: Super Admin access required",
        });
    }
    next();
};

router.use(requireSuperAdmin);

router.get("/stats", SuperAdminController.getStats);
router.get("/societies", SuperAdminController.getSocieties);
router.post("/admins", SuperAdminController.createSuperAdmin);

module.exports = router;
