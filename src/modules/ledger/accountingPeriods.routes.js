"use strict";

const express = require("express");
const authenticate = require("../../middleware/authenticate");
const { requireBillingPermission } = require("../../middleware/billingAuthorize.middleware");
const { BILLING_PERMISSIONS } = require("../../common/billingPermissions");
const { LedgerController } = require("./ledger.controller");

const router = express.Router();
router.use(authenticate);

router.get(
    "/",
    requireBillingPermission(BILLING_PERMISSIONS.ACCOUNTING_LEDGER_VIEW),
    LedgerController.getAccountingPeriods
);

router.post(
    "/:id/close",
    requireBillingPermission(BILLING_PERMISSIONS.JOURNAL_VOUCHER_APPROVE),
    LedgerController.closePeriod
);

router.post(
    "/:id/reopen",
    requireBillingPermission(BILLING_PERMISSIONS.JOURNAL_VOUCHER_APPROVE),
    LedgerController.reopenPeriod
);

module.exports = router;
