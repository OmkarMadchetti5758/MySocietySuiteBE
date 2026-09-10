"use strict";

const express = require("express");
const VisitorController = require("./visitor.controller");
const authenticate = require("../../middleware/authenticate");

const router = express.Router();

router.use(authenticate);

// Walk-in Visitor (Guard)
router.post("/walk-in", VisitorController.addWalkInVisitor);

// Get pending visitors for resident's flat (Resident action)
router.get("/pending", VisitorController.getPendingVisitors);

// Get all visitor history (Admin/Committee)
router.get("/history", VisitorController.getVisitorHistory);

// Digital QR Pass management (Resident)
router.post("/qr-pass", VisitorController.createQrPass);
router.get("/qr-pass", VisitorController.getMyQrPasses);
router.patch("/qr-pass/:id/revoke", VisitorController.revokeQrPass);

// QR Scanner validation (Guard)
router.post("/qr-scan", VisitorController.validateQrPass);

// Get single visitor entry status
router.get("/:id", VisitorController.getVisitorById);

// Approve/Deny Visitor (Resident)
router.patch("/:id/approve", VisitorController.approveVisitor);

module.exports = router;
