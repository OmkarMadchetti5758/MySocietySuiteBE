"use strict";

const express = require("express");
const SuperAdminController = require("./superAdmin.controller");
const authenticate = require("../../middleware/authenticate");

const router = express.Router();

// All super admin routes must be authenticated and restricted to super_admin role
router.use(authenticate);

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
router.get("/subscription-plans", SuperAdminController.getSubscriptionPlans);
router.get("/societies", SuperAdminController.getSocieties);
router.post("/societies", SuperAdminController.createSociety);
router.get("/societies/:id", SuperAdminController.getSocietyById);
router.put("/societies/:id", SuperAdminController.updateSociety);
router.patch("/societies/:id", SuperAdminController.updateSociety);
router.patch("/societies/:id/status", SuperAdminController.updateSocietyStatus);
router.put("/societies/:id/status", SuperAdminController.updateSocietyStatus);
router.get("/modules", SuperAdminController.getAvailableModules);
router.get("/plans", SuperAdminController.getPlans);
router.post("/plans", SuperAdminController.createPlan);
router.put("/plans/:id", SuperAdminController.updatePlan);
router.post("/admins", SuperAdminController.createSuperAdmin);

module.exports = router;
