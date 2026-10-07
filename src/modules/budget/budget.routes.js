"use strict";

/**
 * Budget Routes
 * Base path: /api/v1/budgets
 *
 * All routes require authentication + society scoping.
 * Access control is enforced per-endpoint in the controller (BRD 4.1).
 *
 * REST API:
 *   GET    /budgets                      list (role-filtered)
 *   POST   /budgets                      create DRAFT
 *   GET    /budgets/eligible-accounts    account picker
 *   GET    /budgets/:id                  budget + lines
 *   GET    /budgets/:id/vs-actual        lines with actuals + flags
 *   PUT    /budgets/:id/lines            saveDraft
 *   POST   /budgets/:id/submit           DRAFT → PENDING_APPROVAL
 *   POST   /budgets/:id/approve          PENDING_APPROVAL → APPROVED
 *   POST   /budgets/:id/send-back        PENDING_APPROVAL → DRAFT
 *   POST   /budgets/:id/withdraw         PENDING_APPROVAL → DRAFT
 *   GET    /budgets/:id/history          audit trail
 */

const express        = require("express");
const authenticate   = require("../../middleware/authenticate");
const injectSocietyId = require("../../middleware/injectSocietyId");
const ctrl           = require("./budget.controller");

const router = express.Router();

// All budget endpoints require auth + society scope
router.use(authenticate);
router.use(injectSocietyId);

// ── Static sub-paths (must come BEFORE /:id routes) ──────────────────────────
router.get("/eligible-accounts", ctrl.getEligibleAccounts);

// ── Collection endpoints ──────────────────────────────────────────────────────
router.get("/",    ctrl.listBudgets);
router.post("/",   ctrl.createBudget);

// ── Item endpoints ────────────────────────────────────────────────────────────
router.get("/:id",           ctrl.getBudget);
router.get("/:id/vs-actual", ctrl.getBudgetVsActual);
router.get("/:id/history",   ctrl.getBudgetHistory);

// ── Line management ───────────────────────────────────────────────────────────
router.put("/:id/lines",     ctrl.saveLines);

// ── State transitions ─────────────────────────────────────────────────────────
router.post("/:id/submit",    ctrl.submitBudget);
router.post("/:id/approve",   ctrl.approveBudget);
router.post("/:id/send-back", ctrl.sendBackBudget);
router.post("/:id/withdraw",  ctrl.withdrawBudget);

module.exports = router;
