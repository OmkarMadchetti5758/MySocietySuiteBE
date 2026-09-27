"use strict";

const express = require("express");
const authenticate = require("../../middleware/authenticate");
const { requireBillingPermission } = require("../../middleware/billingAuthorize.middleware");
const { BILLING_PERMISSIONS } = require("../../common/billingPermissions");
const { AdvanceAccountsController, SecurityDepositsController } = require("./advanceAccountsDeposits.controller");

const router = express.Router();

router.use(authenticate);

// ── ADVANCE ACCOUNTS ────────────────────────────────────────────────────────

// View My (Resident) Advance
router.get(
    "/advance-accounts/my",
    requireBillingPermission(BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_OWN),
    AdvanceAccountsController.getMyAccount
);

// Overview Stats
router.get(
    "/overview-stats",
    requireBillingPermission([
        BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_ALL,
        BILLING_PERMISSIONS.BILLING_DEPOSIT_VIEW_ALL,
        BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_OWN
    ]),
    AdvanceAccountsController.getOverviewStats
);

// Advance Account Details & List
router.post(
    "/advance-accounts/get-or-create",
    requireBillingPermission([BILLING_PERMISSIONS.BILLING_ADVANCE_CREATE, BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_OWN]),
    AdvanceAccountsController.getOrCreateAccount
);

router.get(
    "/advance-accounts",
    requireBillingPermission([BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_ALL, BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_OWN]),
    AdvanceAccountsController.listAccounts
);

router.get(
    "/advance-accounts/:id",
    requireBillingPermission([BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_ALL, BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_OWN]),
    AdvanceAccountsController.getAccountById
);

router.get(
    "/advance-accounts/:id/statement",
    requireBillingPermission([BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_ALL, BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_OWN]),
    AdvanceAccountsController.getAccountStatement
);

// Advance Transactions
router.post(
    "/advance-accounts/:id/credit",
    requireBillingPermission([BILLING_PERMISSIONS.BILLING_ADVANCE_CREATE, BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_OWN]),
    AdvanceAccountsController.creditAccount
);

// Resident online advance top-up via Razorpay
router.post(
    "/advance-accounts/:id/initiate-online-payment",
    requireBillingPermission(BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_OWN),
    AdvanceAccountsController.initiateAdvanceOnlinePayment
);

router.post(
    "/advance-accounts/:id/verify-online-payment",
    requireBillingPermission(BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_OWN),
    AdvanceAccountsController.verifyAdvanceOnlinePayment
);

router.post(
    "/advance-accounts/:id/allocate",
    requireBillingPermission(BILLING_PERMISSIONS.BILLING_ADVANCE_ALLOCATE),
    AdvanceAccountsController.allocateAdvance
);

router.post(
    "/advance-accounts/:id/refund",
    requireBillingPermission(BILLING_PERMISSIONS.BILLING_ADVANCE_REFUND),
    AdvanceAccountsController.refundAdvance
);

// Allocations
router.get(
    "/advance-allocations",
    requireBillingPermission([BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_ALL, BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_OWN]),
    AdvanceAccountsController.listAllocations
);

router.post(
    "/advance-allocations/:id/reverse",
    requireBillingPermission(BILLING_PERMISSIONS.BILLING_ADVANCE_REVERSE_ALLOCATION),
    AdvanceAccountsController.reverseAllocation
);


// ── SECURITY DEPOSITS ───────────────────────────────────────────────────────

// Deposit Types
router.get(
    "/security-deposit-types",
    requireBillingPermission([BILLING_PERMISSIONS.BILLING_DEPOSIT_VIEW_ALL, BILLING_PERMISSIONS.BILLING_DEPOSIT_VIEW_OWN]),
    SecurityDepositsController.listDepositTypes
);

router.post(
    "/security-deposit-types",
    requireBillingPermission(BILLING_PERMISSIONS.BILLING_DEPOSIT_CONFIGURE),
    SecurityDepositsController.createDepositType
);

router.patch(
    "/security-deposit-types/:id",
    requireBillingPermission(BILLING_PERMISSIONS.BILLING_DEPOSIT_CONFIGURE),
    SecurityDepositsController.updateDepositType
);

// My Deposits
router.get(
    "/security-deposits/my",
    requireBillingPermission(BILLING_PERMISSIONS.BILLING_DEPOSIT_VIEW_OWN),
    SecurityDepositsController.getMyDeposits
);

// Deposits List & Details
router.get(
    "/security-deposits",
    requireBillingPermission([BILLING_PERMISSIONS.BILLING_DEPOSIT_VIEW_ALL, BILLING_PERMISSIONS.BILLING_DEPOSIT_VIEW_OWN]),
    SecurityDepositsController.listDeposits
);

router.get(
    "/security-deposits/:id",
    requireBillingPermission([BILLING_PERMISSIONS.BILLING_DEPOSIT_VIEW_ALL, BILLING_PERMISSIONS.BILLING_DEPOSIT_VIEW_OWN]),
    SecurityDepositsController.getDepositById
);

router.get(
    "/security-deposits/:id/statement",
    requireBillingPermission([BILLING_PERMISSIONS.BILLING_DEPOSIT_VIEW_ALL, BILLING_PERMISSIONS.BILLING_DEPOSIT_VIEW_OWN]),
    SecurityDepositsController.getDepositStatement
);

// Deposit Operations
router.post(
    "/security-deposits",
    requireBillingPermission(BILLING_PERMISSIONS.BILLING_DEPOSIT_CREATE),
    SecurityDepositsController.collectDeposit
);

router.post(
    "/security-deposits/:id/adjustments",
    requireBillingPermission(BILLING_PERMISSIONS.BILLING_DEPOSIT_ADJUST),
    SecurityDepositsController.adjustDeposit
);

// Deposit Refunds
router.get(
    "/deposit-refunds",
    requireBillingPermission([BILLING_PERMISSIONS.BILLING_DEPOSIT_VIEW_ALL, BILLING_PERMISSIONS.BILLING_DEPOSIT_VIEW_OWN]),
    SecurityDepositsController.listRefundRequests
);

router.post(
    "/security-deposits/:id/refund-request",
    requireBillingPermission([BILLING_PERMISSIONS.BILLING_DEPOSIT_REFUND, BILLING_PERMISSIONS.BILLING_DEPOSIT_VIEW_OWN]),
    SecurityDepositsController.requestRefund
);

router.post(
    "/deposit-refunds/:id/approve",
    requireBillingPermission(BILLING_PERMISSIONS.BILLING_DEPOSIT_APPROVE_REFUND),
    SecurityDepositsController.approveRefund
);

router.post(
    "/deposit-refunds/:id/reject",
    requireBillingPermission(BILLING_PERMISSIONS.BILLING_DEPOSIT_APPROVE_REFUND),
    SecurityDepositsController.rejectRefund
);

router.post(
    "/deposit-refunds/:id/process",
    requireBillingPermission(BILLING_PERMISSIONS.BILLING_DEPOSIT_REFUND),
    SecurityDepositsController.processRefund
);


// ── GENERAL ─────────────────────────────────────────────────────────────────

// All Transactions (Advance + Deposit)
router.get(
    "/transactions",
    requireBillingPermission([
        BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_ALL,
        BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_OWN,
        BILLING_PERMISSIONS.BILLING_DEPOSIT_VIEW_ALL,
        BILLING_PERMISSIONS.BILLING_DEPOSIT_VIEW_OWN
    ]),
    SecurityDepositsController.listAllTransactions
);

// Audit Logs
router.get(
    "/audit",
    requireBillingPermission(BILLING_PERMISSIONS.AUDIT_LOG_VIEW),
    SecurityDepositsController.getAuditLogs
);

module.exports = router;
