"use strict";

const express = require("express");
const authenticate = require("../../middleware/authenticate");
const { requireBillingPermission } = require("../../middleware/billingAuthorize.middleware");
const { BILLING_PERMISSIONS } = require("../../common/billingPermissions");
const { LedgerController } = require("./ledger.controller");

const router = express.Router();
router.use(authenticate);

// ── Journal Entries CRUD ──────────────────────────────────────────────────────
router.get(
    "/",
    requireBillingPermission(BILLING_PERMISSIONS.ACCOUNTING_LEDGER_VIEW),
    LedgerController.listJournalEntries
);

router.get(
    "/:id",
    requireBillingPermission(BILLING_PERMISSIONS.ACCOUNTING_LEDGER_VIEW),
    LedgerController.getJournalEntry
);

router.post(
    "/",
    requireBillingPermission(BILLING_PERMISSIONS.JOURNAL_VOUCHER_CREATE),
    LedgerController.createJournalEntry
);

// ── Journal Entry Workflow ────────────────────────────────────────────────────
router.post(
    "/:id/submit",
    requireBillingPermission(BILLING_PERMISSIONS.JOURNAL_VOUCHER_UPDATE),
    LedgerController.submitJournalEntry
);

router.post(
    "/:id/approve",
    requireBillingPermission(BILLING_PERMISSIONS.JOURNAL_VOUCHER_APPROVE),
    LedgerController.approveJournalEntry
);

router.post(
    "/:id/post",
    requireBillingPermission(BILLING_PERMISSIONS.JOURNAL_VOUCHER_APPROVE),
    LedgerController.postJournalEntry
);

router.post(
    "/:id/reject",
    requireBillingPermission(BILLING_PERMISSIONS.JOURNAL_VOUCHER_APPROVE),
    LedgerController.rejectJournalEntry
);

router.post(
    "/:id/reverse",
    requireBillingPermission(BILLING_PERMISSIONS.JOURNAL_VOUCHER_DELETE),   // Reverse requires delete-level permission
    LedgerController.reverseJournalEntry
);

module.exports = router;
