"use strict";

const express = require("express");
const authenticate = require("../../middleware/authenticate");
const { requireBillingPermission } = require("../../middleware/billingAuthorize.middleware");
const { BILLING_PERMISSIONS } = require("../../common/billingPermissions");
const { LedgerController } = require("./ledger.controller");

const router = express.Router();

router.use(authenticate);

// ── Chart of Accounts ─────────────────────────────────────────────────────────
router.get(
    "/",
    requireBillingPermission(BILLING_PERMISSIONS.ACCOUNTING_LEDGER_VIEW),
    LedgerController.getChartOfAccounts
);

router.post(
    "/",
    requireBillingPermission(BILLING_PERMISSIONS.BILLING_ADVANCE_CREATE),  // Any finance creator role
    LedgerController.createAccount
);

router.post(
    "/seed",
    requireBillingPermission(BILLING_PERMISSIONS.ACCOUNTING_LEDGER_VIEW),
    LedgerController.seedChartOfAccounts
);

router.patch(
    "/:id/deactivate",
    requireBillingPermission(BILLING_PERMISSIONS.BILLING_ADVANCE_CREATE),
    LedgerController.deactivateAccount
);

module.exports = router;
