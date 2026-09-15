"use strict";

const express = require("express");
const authenticate = require("../../middleware/authenticate");
const { requireBillingPermission } = require("../../middleware/billingAuthorize.middleware");
const { BILLING_PERMISSIONS } = require("../../common/billingPermissions");
const BillingController = require("./billing.controller");

const router = express.Router();

// Apply global JWT authentication to all billing routes
router.use(authenticate);

// ── 1. Charge Heads ────────────────────────────────────────────────────────
router.get(
    "/charge-heads",
    requireBillingPermission(BILLING_PERMISSIONS.CHARGE_HEAD_VIEW),
    BillingController.getChargeHeads
);
router.get(
    "/charge-heads/:id",
    requireBillingPermission(BILLING_PERMISSIONS.CHARGE_HEAD_VIEW),
    BillingController.getChargeHeadById
);
router.post(
    "/charge-heads",
    requireBillingPermission(BILLING_PERMISSIONS.CHARGE_HEAD_CREATE),
    BillingController.createChargeHead
);
router.patch(
    "/charge-heads/:id",
    requireBillingPermission(BILLING_PERMISSIONS.CHARGE_HEAD_UPDATE),
    BillingController.updateChargeHead
);
router.delete(
    "/charge-heads/:id",
    requireBillingPermission(BILLING_PERMISSIONS.CHARGE_HEAD_UPDATE),
    BillingController.deleteChargeHead
);
router.post(
    "/charge-heads/:id/submit",
    requireBillingPermission(BILLING_PERMISSIONS.CHARGE_HEAD_UPDATE),
    BillingController.submitChargeHead
);
router.post(
    "/charge-heads/:id/approve",
    requireBillingPermission(BILLING_PERMISSIONS.CHARGE_HEAD_APPROVE),
    BillingController.approveChargeHead
);
router.post(
    "/charge-heads/:id/reject",
    requireBillingPermission(BILLING_PERMISSIONS.CHARGE_HEAD_APPROVE),
    BillingController.rejectChargeHead
);

// ── 1B. Billing Configuration ─────────────────────────────────────────────
router.get(
    "/billing-config",
    requireBillingPermission(BILLING_PERMISSIONS.CONFIG_VIEW),
    BillingController.getBillingConfig
);
router.post(
    "/billing-config",
    requireBillingPermission(BILLING_PERMISSIONS.CONFIG_UPDATE),
    BillingController.upsertBillingConfig
);
router.patch(
    "/billing-config",
    requireBillingPermission(BILLING_PERMISSIONS.CONFIG_UPDATE),
    BillingController.upsertBillingConfig
);

// ── 2. Invoices ────────────────────────────────────────────────────────────

// Invoice summary statistics (dashboard cards)
router.get(
    "/invoices/stats",
    requireBillingPermission([BILLING_PERMISSIONS.INVOICE_VIEW, BILLING_PERMISSIONS.OWN_INVOICE_VIEW]),
    BillingController.getInvoiceSummaryStats
);

// List all invoices (paginated, filtered, searched)
router.get(
    "/invoices",
    requireBillingPermission(BILLING_PERMISSIONS.INVOICE_VIEW),
    BillingController.getInvoices
);

// Preview invoice calculation (no DB write)
router.post(
    "/invoices/preview",
    requireBillingPermission(BILLING_PERMISSIONS.INVOICE_GENERATE),
    BillingController.previewInvoiceCalculation
);

// Bulk generate invoices
router.post(
    "/invoices/bulk-generate",
    requireBillingPermission(BILLING_PERMISSIONS.INVOICE_GENERATE),
    BillingController.bulkGenerateInvoices
);

// Generate single invoice
router.post(
    "/invoices/generate",
    requireBillingPermission(BILLING_PERMISSIONS.INVOICE_GENERATE),
    BillingController.generateInvoice
);

// Get single invoice by ID
router.get(
    "/invoices/:id",
    requireBillingPermission(BILLING_PERMISSIONS.INVOICE_VIEW),
    BillingController.getInvoiceById
);

// Cancel invoice
router.post(
    "/invoices/:id/cancel",
    requireBillingPermission(BILLING_PERMISSIONS.INVOICE_UPDATE),
    BillingController.cancelInvoice
);

// Record payment on invoice
router.post(
    "/invoices/:id/payments",
    requireBillingPermission(BILLING_PERMISSIONS.PAYMENT_OFFLINE_CREATE),
    BillingController.recordInvoicePayment
);

// Get payment history for invoice
router.get(
    "/invoices/:id/payments",
    requireBillingPermission(BILLING_PERMISSIONS.PAYMENT_VIEW),
    BillingController.getInvoicePayments
);

// ── 2B. One-Time Charges ───────────────────────────────────────────────────
router.post(
    "/one-time-charges",
    requireBillingPermission(BILLING_PERMISSIONS.INVOICE_GENERATE),
    BillingController.addOneTimeCharge
);
router.get(
    "/one-time-charges",
    requireBillingPermission(BILLING_PERMISSIONS.INVOICE_VIEW),
    BillingController.listOneTimeCharges
);

// Resident Own-Invoices Scope (IDOR Protected)
router.get(
    "/my/invoices/stats",
    requireBillingPermission(BILLING_PERMISSIONS.OWN_INVOICE_VIEW),
    BillingController.getInvoiceSummaryStats
);
router.get(
    "/my/invoices",
    requireBillingPermission(BILLING_PERMISSIONS.OWN_INVOICE_VIEW),
    BillingController.getMyInvoices
);
router.get(
    "/my/invoices/:id",
    requireBillingPermission(BILLING_PERMISSIONS.OWN_INVOICE_VIEW),
    BillingController.getMyInvoiceById
);
router.post(
    "/my/invoices/:id/pay",
    requireBillingPermission(BILLING_PERMISSIONS.OWN_PAYMENT_CREATE),
    BillingController.payMyInvoice
);

// ── 3. Offline Payments ───────────────────────────────────────────────────
router.post(
    "/payments/offline",
    requireBillingPermission(BILLING_PERMISSIONS.PAYMENT_OFFLINE_CREATE),
    BillingController.recordOfflinePayment
);

// ── 4. Credit Notes & Discounts ───────────────────────────────────────────
router.post(
    "/credit-notes",
    requireBillingPermission(BILLING_PERMISSIONS.CREDIT_NOTE_CREATE),
    BillingController.createCreditNote
);
router.post(
    "/credit-notes/:id/approve",
    requireBillingPermission(BILLING_PERMISSIONS.CREDIT_NOTE_APPROVE),
    BillingController.approveCreditNote
);
router.post(
    "/discounts",
    requireBillingPermission(BILLING_PERMISSIONS.DISCOUNT_CREATE),
    BillingController.createDiscount
);
router.post(
    "/discounts/:id/approve",
    requireBillingPermission(BILLING_PERMISSIONS.DISCOUNT_APPROVE),
    BillingController.approveDiscount
);

// ── 5. Journal Vouchers & Vendor Payments ──────────────────────────────────
router.post(
    "/journal-vouchers",
    requireBillingPermission(BILLING_PERMISSIONS.JOURNAL_VOUCHER_CREATE),
    BillingController.createJournalVoucher
);
router.post(
    "/journal-vouchers/:id/approve",
    requireBillingPermission(BILLING_PERMISSIONS.JOURNAL_VOUCHER_APPROVE),
    BillingController.approveJournalVoucher
);
router.post(
    "/vendor-payments",
    requireBillingPermission(BILLING_PERMISSIONS.VENDOR_PAYMENT_CREATE),
    BillingController.createVendorPayment
);
router.post(
    "/vendor-payments/:id/approve",
    requireBillingPermission(BILLING_PERMISSIONS.VENDOR_PAYMENT_APPROVE),
    BillingController.approveVendorPayment
);

// ── 6. Budgets, Reconciliation & Financial Reports ────────────────────────
router.post(
    "/budgets",
    requireBillingPermission(BILLING_PERMISSIONS.BUDGET_CREATE),
    BillingController.createBudget
);
router.post(
    "/budgets/:id/approve",
    requireBillingPermission(BILLING_PERMISSIONS.BUDGET_APPROVE),
    BillingController.approveBudget
);
router.post(
    "/reconciliation",
    requireBillingPermission(BILLING_PERMISSIONS.RECONCILIATION_RECONCILE),
    BillingController.reconcileAccounts
);
router.get(
    "/reports/financial",
    requireBillingPermission(BILLING_PERMISSIONS.REPORT_VIEW),
    BillingController.getFinancialReports
);

// Resident Own Ledger & Financial Audit Log
router.get(
    "/my/ledger",
    requireBillingPermission(BILLING_PERMISSIONS.OWN_LEDGER_VIEW),
    BillingController.getMyLedger
);
router.get(
    "/audit-logs",
    requireBillingPermission(BILLING_PERMISSIONS.AUDIT_LOG_VIEW),
    BillingController.getAuditLogs
);

module.exports = router;
