"use strict";

const express = require("express");
const VisitorController = require("./visitor.controller");
const authenticate = require("../../middleware/authenticate");
const authorize = require("../../middleware/authorize");
const checkPermission = require("../../middleware/checkPermission");
const { ROLES, MODULES, PERMISSION_LEVELS } = require("../../common/constants");


const router = express.Router();

router.use(authenticate);

// Walk-in Visitor (Guard only)
router.post("/walk-in", authorize(ROLES.SECURITY_GUARD, ROLES.GUARD_MANAGER), VisitorController.addWalkInVisitor);

// Get pending visitors for resident's flat (Resident action)
router.get("/pending", checkPermission(MODULES.VISITOR_MANAGEMENT, PERMISSION_LEVELS.VIEW), VisitorController.getPendingVisitors);

// Get all visitor history (Admin/Committee only)
router.get("/history", checkPermission(MODULES.VISITOR_MANAGEMENT, PERMISSION_LEVELS.VIEW), VisitorController.getVisitorHistory);

// Digital QR Pass management (Resident)
router.post("/qr-pass", checkPermission(MODULES.VISITOR_MANAGEMENT, PERMISSION_LEVELS.MANAGE), VisitorController.createQrPass);
router.get("/qr-pass", checkPermission(MODULES.VISITOR_MANAGEMENT, PERMISSION_LEVELS.MANAGE), VisitorController.getMyQrPasses);
router.patch("/qr-pass/:id/revoke", checkPermission(MODULES.VISITOR_MANAGEMENT, PERMISSION_LEVELS.MANAGE), VisitorController.revokeQrPass);

// QR Scanner validation (Guard only)
router.post("/qr-scan", authorize(ROLES.SECURITY_GUARD, ROLES.GUARD_MANAGER), VisitorController.validateQrPass);

// Get single visitor entry status
router.get("/:id", checkPermission(MODULES.VISITOR_MANAGEMENT, PERMISSION_LEVELS.VIEW), VisitorController.getVisitorById);

// Approve/Deny Visitor (Resident/Guard/Admin)
router.patch("/:id/approve", checkPermission(MODULES.VISITOR_MANAGEMENT, PERMISSION_LEVELS.MANAGE), VisitorController.approveVisitor);

module.exports = router;