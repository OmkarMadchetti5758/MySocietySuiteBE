"use strict";

const express = require("express");
const router = express.Router();
const authenticate = require("../../middleware/authenticate");
const injectSocietyId = require("../../middleware/injectSocietyId");
const controller = require("./reconciliation.controller");

// Apply core auth & society isolation middleware across all routes
router.use(authenticate);
router.use(injectSocietyId);

// ── 1. Financial Accounts ───────────────────────────────────────────────────
router.get("/accounts", controller.getAccounts);
router.post("/accounts", controller.createAccount);
router.patch("/accounts/:id", controller.updateAccount);
router.patch("/accounts/:id/status", controller.toggleAccountStatus);

// ── 2. Account Transactions ─────────────────────────────────────────────────
router.get("/account-transactions", controller.getAccountTransactions);

// ── 3. Bank Statements & Matching ───────────────────────────────────────────
router.post("/bank-statements/import", controller.importBankStatement);
router.get("/bank-statements/:statementId/transactions", controller.getStatementTransactions);
router.post("/bank-statements/manual-match", controller.manualMatchTransaction);

// ── 4. Account Transfers ───────────────────────────────────────────────────
router.get("/account-transfers", controller.getTransfers);
router.post("/account-transfers", controller.createTransfer);

// ── 5. Adjustments & Charges ────────────────────────────────────────────────
router.get("/adjustments", controller.getAdjustments);
router.post("/adjustments", controller.createAdjustment);

// ── 6. Cash Reconciliation & Denominations ──────────────────────────────────
router.get("/cash-counts", controller.getCashCounts);
router.post("/cash-counts", controller.recordCashCount);

// ── 7. Reconciliation Session & History ────────────────────────────────────
router.get("/reconciliations", controller.getReconciliationHistory);
router.post("/reconciliations/finalize", controller.finalizeReconciliation);

module.exports = router;
