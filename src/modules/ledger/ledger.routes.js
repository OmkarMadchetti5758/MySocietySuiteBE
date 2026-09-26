"use strict";

const express = require("express");
const authenticate = require("../../middleware/authenticate");
const { requireBillingPermission } = require("../../middleware/billingAuthorize.middleware");
const { BILLING_PERMISSIONS } = require("../../common/billingPermissions");
const { LedgerController } = require("./ledger.controller");

const router = express.Router();

// All ledger routes require authentication
router.use(authenticate);

// ── Overview ──────────────────────────────────────────────────────────────────
router.get(
    "/overview",
    requireBillingPermission(BILLING_PERMISSIONS.ACCOUNTING_LEDGER_VIEW),
    LedgerController.getOverview
);

// ── General Ledger ────────────────────────────────────────────────────────────
router.get(
    "/general-ledger",
    requireBillingPermission(BILLING_PERMISSIONS.ACCOUNTING_LEDGER_VIEW),
    LedgerController.getGeneralLedger
);

// ── My Ledger (Resident — own records only) ───────────────────────────────────
router.get(
    "/my",
    requireBillingPermission(BILLING_PERMISSIONS.OWN_LEDGER_VIEW),
    LedgerController.getMyLedger
);

// ── Account Statement ─────────────────────────────────────────────────────────
router.get(
    "/accounts/:accountId/statement",
    requireBillingPermission(BILLING_PERMISSIONS.ACCOUNTING_LEDGER_VIEW),
    LedgerController.getAccountStatement
);

// ── Adjustments / Reversals ───────────────────────────────────────────────────
// (Reversals are handled under journal entries: POST /journal-entries/:id/reverse)

// ── Audit Logs ────────────────────────────────────────────────────────────────
router.get(
    "/audit-logs",
    requireBillingPermission(BILLING_PERMISSIONS.AUDIT_VIEW),
    LedgerController.getAuditLogs
);

module.exports = router;
