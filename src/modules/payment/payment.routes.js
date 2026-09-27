"use strict";

const express = require("express");
const authenticate = require("../../middleware/authenticate");
const PaymentController = require("./payment.controller");

const router = express.Router();

// Webhook route (unauthenticated, signature checked inside handler)
router.post("/webhook/razorpay", PaymentController.handleWebhook);

// All other payment endpoints require JWT authentication
router.use(authenticate);

// ── Resident & General Payment Endpoints ──
router.post("/online/initiate", PaymentController.initiateOnlinePayment);
router.post("/online/verify", PaymentController.verifyOnlinePayment);

// ── Accountant & Admin Payment Endpoints ──
router.post("/offline", PaymentController.recordOfflinePayment);
router.get("/overview", PaymentController.getOverview);
router.get("/list", PaymentController.getPaymentsList);
router.get("/pending-failed", PaymentController.getPendingFailed);
router.post("/manual-reconcile", PaymentController.manualReconcile);
router.get("/collections-analytics", PaymentController.getCollectionsAnalytics);

module.exports = router;