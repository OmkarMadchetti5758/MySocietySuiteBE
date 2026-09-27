"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const BillingService = require("../modules/billing/billing.service");
const { BILLING_PERMISSIONS } = require("../common/billingPermissions");
const { hasBillingPermissionAsync } = require("../services/billingAuthorization.service");
const { requireBillingPermission } = require("../middleware/billingAuthorize.middleware");
const AppError = require("../common/AppError");

async function runVendorPaymentMarkPaidTests() {
    console.log("=========================================");
    console.log("Running Phase 7: Mark Paid + Accounting Integration Tests...");
    console.log("=========================================");

    const socAId = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad0000aa");
    const socBId = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad0000bb");

    const adminId = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000021");
    const accountantId = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000010");
    const residentId = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000030");

    // Accounts for testing
    const validAccountA = {
        _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000051"),
        societyId: socAId,
        accountName: "HDFC Operations Account",
        accountType: "BANK",
        accountNumber: "1234567890",
        openingBalance: 100000,
        currentBalance: 100000,
        status: "ACTIVE",
        async save() {
            return this;
        },
    };

    const inactiveAccountA = {
        _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000052"),
        societyId: socAId,
        accountName: "Old Inactive Account",
        accountType: "BANK",
        openingBalance: 5000,
        currentBalance: 5000,
        status: "INACTIVE",
        async save() {
            return this;
        },
    };

    const accountSocB = {
        _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000053"),
        societyId: socBId, // Cross-society account
        accountName: "Society B Bank Account",
        accountType: "BANK",
        openingBalance: 200000,
        currentBalance: 200000,
        status: "ACTIVE",
        async save() {
            return this;
        },
    };

    const mockAccounts = [validAccountA, inactiveAccountA, accountSocB];
    const mockAccountTransactions = [];
    const mockAuditLogs = [];

    const mockPayments = [
        // 0: Approved payment with financialAccountId set (for test a, b, c, k, l)
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000061"),
            societyId: socAId,
            paymentNumber: "VP-2026-00061",
            vendorName: "Apex Plumbing",
            amount: 15000,
            paymentMode: "bank_transfer",
            status: "approved",
            financialAccountId: validAccountA._id,
            requestedBy: accountantId,
            createdBy: accountantId,
            approvedBy: adminId,
            approvedAt: new Date("2026-01-10"),
            paidBy: null,
            paidAt: null,
        },
        // 1: Pending approval payment (for test d)
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000062"),
            societyId: socAId,
            paymentNumber: "VP-2026-00062",
            vendorName: "Sparkle Cleaning",
            amount: 8000,
            paymentMode: "cheque",
            status: "pending_approval",
            financialAccountId: validAccountA._id,
            requestedBy: accountantId,
            createdBy: accountantId,
            paidBy: null,
            paidAt: null,
        },
        // 2: Rejected payment (for test e)
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000063"),
            societyId: socAId,
            paymentNumber: "VP-2026-00063",
            vendorName: "Elevator Services",
            amount: 25000,
            paymentMode: "bank_transfer",
            status: "rejected",
            financialAccountId: validAccountA._id,
            requestedBy: accountantId,
            createdBy: accountantId,
            rejectedBy: adminId,
            rejectedAt: new Date("2026-01-11"),
            paidBy: null,
            paidAt: null,
        },
        // 3: Already paid payment (for test f)
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000064"),
            societyId: socAId,
            paymentNumber: "VP-2026-00064",
            vendorName: "Security Agency",
            amount: 30000,
            paymentMode: "bank_transfer",
            status: "paid",
            financialAccountId: validAccountA._id,
            requestedBy: accountantId,
            createdBy: accountantId,
            approvedBy: adminId,
            paidBy: accountantId,
            paidAt: new Date("2026-01-12"),
        },
        // 4: Cross-society payment in Society B (for test h)
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000065"),
            societyId: socBId,
            paymentNumber: "VP-2026-00065",
            vendorName: "Other Soc Vendor",
            amount: 5000,
            paymentMode: "cash",
            status: "approved",
            financialAccountId: accountSocB._id,
            requestedBy: accountantId,
            createdBy: accountantId,
            approvedBy: adminId,
            paidBy: null,
            paidAt: null,
        },
        // 5: Approved payment with no financialAccountId set (for test i)
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000066"),
            societyId: socAId,
            paymentNumber: "VP-2026-00066",
            vendorName: "Green Landscapes",
            amount: 7000,
            paymentMode: "bank_transfer",
            status: "approved",
            financialAccountId: null,
            requestedBy: accountantId,
            createdBy: accountantId,
            approvedBy: adminId,
            paidBy: null,
            paidAt: null,
        },
        // 6: Approved payment with inactive financialAccountId (for test i)
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000067"),
            societyId: socAId,
            paymentNumber: "VP-2026-00067",
            vendorName: "Green Landscapes 2",
            amount: 2000,
            paymentMode: "bank_transfer",
            status: "approved",
            financialAccountId: inactiveAccountA._id,
            requestedBy: accountantId,
            createdBy: accountantId,
            approvedBy: adminId,
            paidBy: null,
            paidAt: null,
        },
        // 7: Approved payment referencing Society B's account (for test j)
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000068"),
            societyId: socAId,
            paymentNumber: "VP-2026-00068",
            vendorName: "City Painters",
            amount: 12000,
            paymentMode: "bank_transfer",
            status: "approved",
            financialAccountId: accountSocB._id,
            requestedBy: accountantId,
            createdBy: accountantId,
            approvedBy: adminId,
            paidBy: null,
            paidAt: null,
        },
        // 8: Approved payment for concurrency test (for test m & n)
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000069"),
            societyId: socAId,
            paymentNumber: "VP-2026-00069",
            vendorName: "Rapid Couriers",
            amount: 10000,
            paymentMode: "upi",
            status: "approved",
            financialAccountId: validAccountA._id,
            requestedBy: accountantId,
            createdBy: accountantId,
            approvedBy: adminId,
            paidBy: null,
            paidAt: null,
        },
    ];

    const mockVendorPaymentModel = {
        async findOneAndUpdate(query, update, options) {
            const item = mockPayments.find((p) => {
                if (query._id && String(p._id) !== String(query._id)) return false;
                if (query.societyId && String(p.societyId) !== String(query.societyId)) return false;
                if (query.status) {
                    if (query.status.$in) {
                        if (!query.status.$in.includes(p.status)) return false;
                    } else if (p.status !== query.status) {
                        return false;
                    }
                }
                return true;
            });
            if (!item) return null;
            if (update.$set) {
                Object.assign(item, update.$set);
            }
            return { ...item };
        },
        async updateOne(query, update) {
            const item = mockPayments.find((p) => String(p._id) === String(query._id));
            if (item && update.$set) {
                Object.assign(item, update.$set);
            }
            return { modifiedCount: item ? 1 : 0 };
        },
        findOne(query) {
            const item = mockPayments.find((p) => {
                if (query._id && String(p._id) !== String(query._id)) return false;
                if (query.societyId && String(p.societyId) !== String(query.societyId)) return false;
                return true;
            });
            return {
                lean: async () => (item ? { ...item } : null),
                then: (resolve) => resolve(item ? { ...item } : null),
            };
        },
    };

    const mockFinancialAccountModel = {
        async findById(id) {
            const acc = mockAccounts.find((a) => String(a._id) === String(id));
            return acc || null;
        },
        async findOne(query) {
            const acc = mockAccounts.find((a) => {
                if (query._id && String(a._id) !== String(query._id)) return false;
                if (query.societyId && String(a.societyId) !== String(query.societyId)) return false;
                return true;
            });
            return acc || null;
        },
        async updateOne(query, update) {
            const acc = mockAccounts.find((a) => String(a._id) === String(query._id));
            if (acc && update.$set) {
                Object.assign(acc, update.$set);
            }
            return { modifiedCount: acc ? 1 : 0 };
        },
    };

    const mockAccountTransactionModel = {
        async create(doc) {
            const newDoc = {
                _id: new mongoose.Types.ObjectId(),
                ...doc,
                createdAt: new Date(),
            };
            mockAccountTransactions.push(newDoc);
            return newDoc;
        },
    };

    const mockAuditLogModel = {
        async create(log) {
            mockAuditLogs.push(log);
            return log;
        },
    };

    const mockOpsDb = {
        models: {
            VendorPayment: mockVendorPaymentModel,
            FinancialAccount: mockFinancialAccountModel,
            AccountTransaction: mockAccountTransactionModel,
            BillingAuditLog: mockAuditLogModel,
        },
        model(name) {
            return this.models[name];
        },
    };

    const accountantReq = {
        user: {
            id: accountantId,
            societyId: socAId,
            role: "accountant",
            roleKeys: ["accountant"],
        },
        opsDb: mockOpsDb,
    };

    const adminReq = {
        user: {
            id: adminId,
            societyId: socAId,
            role: "admin",
            roleKeys: ["admin"],
        },
        opsDb: mockOpsDb,
    };

    const residentReq = {
        user: {
            id: residentId,
            societyId: socAId,
            role: "resident",
            roleKeys: ["resident"],
        },
        opsDb: mockOpsDb,
    };

    // ──────────────────────────────────────────────────────────────────────────
    // Test a, b, c, k, l: Authorized user marks APPROVED payment as PAID
    // ──────────────────────────────────────────────────────────────────────────
    console.log("Testing a, b, c, k, l: Authorized user marks APPROVED payment as PAID, stores paidBy/paidAt, updates balance & creates AccountTransaction...");
    const initialAccountBalance = validAccountA.currentBalance; // 100,000
    const paymentTargetA = mockPayments[0]; // 15,000

    const paidResult = await BillingService.markVendorPaymentPaid(
        accountantReq,
        paymentTargetA._id.toString()
    );

    assert.strictEqual(paidResult.status, "paid", "Status must transition to 'paid'");
    assert.strictEqual(String(paidResult.paidBy), String(accountantId), "b. paidBy must equal authenticated user ID");
    assert.ok(paidResult.paidAt instanceof Date, "c. paidAt must be stored as Date");
    assert.strictEqual(
        validAccountA.currentBalance,
        initialAccountBalance - paymentTargetA.amount,
        "l. FinancialAccount balance must be decremented by payment amount"
    );

    const tx = mockAccountTransactions.find((t) => String(t.referenceId) === String(paymentTargetA._id));
    assert.ok(tx, "k. An AccountTransaction must be created");
    assert.strictEqual(tx.transactionType, "EXPENSE", "Transaction type must be 'EXPENSE'");
    assert.strictEqual(tx.direction, "DEBIT", "Transaction direction must be 'DEBIT'");
    assert.strictEqual(tx.amount, 15000, "Transaction amount must match payment amount");
    assert.strictEqual(tx.balanceAfterTransaction, 85000, "balanceAfterTransaction must reflect updated balance");
    assert.strictEqual(tx.paymentMethod, "BANK_TRANSFER", "Payment method must be mapped to BANK_TRANSFER");
    assert.strictEqual(tx.referenceModel, "VendorPayment", "referenceModel must be 'VendorPayment'");

    // Check audit log
    const audit = mockAuditLogs.find((a) => a.action === BILLING_PERMISSIONS.VENDOR_PAYMENT_MARK_PAID && String(a.resourceId) === String(paymentTargetA._id));
    assert.ok(audit, "Audit log must be recorded for mark-paid action");
    console.log("✅ a, b, c, k, l passed.");

    // ──────────────────────────────────────────────────────────────────────────
    // Test d: pending_approval payment cannot be marked paid
    // ──────────────────────────────────────────────────────────────────────────
    console.log("Testing d: pending_approval payment cannot be marked paid...");
    let pendingErr = null;
    try {
        await BillingService.markVendorPaymentPaid(
            accountantReq,
            mockPayments[1]._id.toString()
        );
    } catch (err) {
        pendingErr = err;
    }
    assert.ok(pendingErr instanceof AppError, "Should throw AppError");
    assert.strictEqual(pendingErr.statusCode, 409, "Should return 409 Conflict");
    assert.match(pendingErr.message, /pending approval/i);
    console.log("✅ d. pending_approval cannot be marked paid (409) passed.");

    // ──────────────────────────────────────────────────────────────────────────
    // Test e: rejected payment cannot be marked paid
    // ──────────────────────────────────────────────────────────────────────────
    console.log("Testing e: rejected payment cannot be marked paid...");
    let rejectedErr = null;
    try {
        await BillingService.markVendorPaymentPaid(
            accountantReq,
            mockPayments[2]._id.toString()
        );
    } catch (err) {
        rejectedErr = err;
    }
    assert.ok(rejectedErr instanceof AppError, "Should throw AppError");
    assert.strictEqual(rejectedErr.statusCode, 409, "Should return 409 Conflict");
    assert.match(rejectedErr.message, /rejected/i);
    console.log("✅ e. rejected payment cannot be marked paid (409) passed.");

    // ──────────────────────────────────────────────────────────────────────────
    // Test f: already-paid payment cannot be marked paid again
    // ──────────────────────────────────────────────────────────────────────────
    console.log("Testing f: already-paid payment cannot be marked paid again...");
    let paidAgainErr = null;
    try {
        await BillingService.markVendorPaymentPaid(
            accountantReq,
            mockPayments[3]._id.toString()
        );
    } catch (err) {
        paidAgainErr = err;
    }
    assert.ok(paidAgainErr instanceof AppError, "Should throw AppError");
    assert.strictEqual(paidAgainErr.statusCode, 409, "Should return 409 Conflict");
    assert.match(paidAgainErr.message, /already paid/i);
    console.log("✅ f. already-paid payment cannot be marked paid again (409) passed.");

    // ──────────────────────────────────────────────────────────────────────────
    // Test g: unauthorized user cannot mark paid
    // ──────────────────────────────────────────────────────────────────────────
    console.log("Testing g: unauthorized user (Resident) cannot mark paid...");
    const hasResidentPerm = await hasBillingPermissionAsync(residentReq.user, BILLING_PERMISSIONS.VENDOR_PAYMENT_MARK_PAID);
    assert.strictEqual(hasResidentPerm, false, "Resident must not have VENDOR_PAYMENT_MARK_PAID permission");

    const hasAccountantPerm = await hasBillingPermissionAsync(accountantReq.user, BILLING_PERMISSIONS.VENDOR_PAYMENT_MARK_PAID);
    assert.strictEqual(hasAccountantPerm, true, "Accountant must have VENDOR_PAYMENT_MARK_PAID permission");

    const hasAdminPerm = await hasBillingPermissionAsync(adminReq.user, BILLING_PERMISSIONS.VENDOR_PAYMENT_MARK_PAID);
    assert.strictEqual(hasAdminPerm, true, "Admin must have VENDOR_PAYMENT_MARK_PAID permission");

    // Test middleware rejection for resident
    let residentDenied = false;
    const middleware = requireBillingPermission(BILLING_PERMISSIONS.VENDOR_PAYMENT_MARK_PAID);
    await middleware(residentReq, {}, (err) => {
        if (err && err.statusCode === 403) residentDenied = true;
    });
    assert.strictEqual(residentDenied, true, "requireBillingPermission middleware must deny Resident with 403");
    console.log("✅ g. unauthorized user cannot mark paid (403) passed.");

    // ──────────────────────────────────────────────────────────────────────────
    // Test h: cross-society payment cannot be marked paid
    // ──────────────────────────────────────────────────────────────────────────
    console.log("Testing h: cross-society payment cannot be marked paid...");
    let crossSocErr = null;
    try {
        // accountantReq belongs to Soc A, payment 4 belongs to Soc B
        await BillingService.markVendorPaymentPaid(
            accountantReq,
            mockPayments[4]._id.toString()
        );
    } catch (err) {
        crossSocErr = err;
    }
    assert.ok(crossSocErr instanceof AppError, "Should throw AppError");
    assert.strictEqual(crossSocErr.statusCode, 404, "Should return 404 Not Found to prevent existence leakage");
    console.log("✅ h. cross-society payment cannot be marked paid (404) passed.");

    // ──────────────────────────────────────────────────────────────────────────
    // Test i: missing / invalid FinancialAccount is handled correctly
    // ──────────────────────────────────────────────────────────────────────────
    console.log("Testing i: missing or inactive FinancialAccount...");
    // Case 1: Missing account on payment and none provided in body
    let missingAccErr = null;
    try {
        await BillingService.markVendorPaymentPaid(
            accountantReq,
            mockPayments[5]._id.toString()
        );
    } catch (err) {
        missingAccErr = err;
    }
    assert.ok(missingAccErr instanceof AppError, "Should throw AppError");
    assert.strictEqual(missingAccErr.statusCode, 400, "Should return 400 Bad Request");
    assert.match(missingAccErr.message, /financial account/i);

    // Case 2: Inactive account on payment
    let inactiveAccErr = null;
    try {
        await BillingService.markVendorPaymentPaid(
            accountantReq,
            mockPayments[6]._id.toString()
        );
    } catch (err) {
        inactiveAccErr = err;
    }
    assert.ok(inactiveAccErr instanceof AppError, "Should throw AppError");
    assert.strictEqual(inactiveAccErr.statusCode, 400, "Should return 400 Bad Request for inactive account");
    assert.match(inactiveAccErr.message, /not active/i);
    console.log("✅ i. missing/invalid FinancialAccount handled correctly (400) passed.");

    // ──────────────────────────────────────────────────────────────────────────
    // Test j: FinancialAccount belongs to another society -> operation rejected
    // ──────────────────────────────────────────────────────────────────────────
    console.log("Testing j: FinancialAccount belongs to another society...");
    let crossAccErr = null;
    try {
        await BillingService.markVendorPaymentPaid(
            accountantReq,
            mockPayments[7]._id.toString()
        );
    } catch (err) {
        crossAccErr = err;
    }
    assert.ok(crossAccErr instanceof AppError, "Should throw AppError");
    assert.strictEqual(crossAccErr.statusCode, 403, "Should return 403 Forbidden");
    assert.match(crossAccErr.message, /another society/i);
    console.log("✅ j. cross-society FinancialAccount rejected (403) passed.");

    // ──────────────────────────────────────────────────────────────────────────
    // Test m & n: Concurrent Mark Paid requests result in only ONE successful payment
    // ──────────────────────────────────────────────────────────────────────────
    console.log("Testing m & n: Concurrent Mark Paid requests atomicity & no duplicates...");
    const concurrentPayment = mockPayments[8]; // 10,000
    const startBalanceBeforeConcurrency = validAccountA.currentBalance; // 85,000
    const startTxCount = mockAccountTransactions.length;

    const [res1, res2] = await Promise.allSettled([
        BillingService.markVendorPaymentPaid(accountantReq, concurrentPayment._id.toString()),
        BillingService.markVendorPaymentPaid(adminReq, concurrentPayment._id.toString()),
    ]);

    const fulfilled = [res1, res2].filter((r) => r.status === "fulfilled");
    const rejectedPromises = [res1, res2].filter((r) => r.status === "rejected");

    assert.strictEqual(fulfilled.length, 1, "m. Exactly ONE concurrent mark-paid request must succeed");
    assert.strictEqual(rejectedPromises.length, 1, "m. Exactly ONE concurrent mark-paid request must be rejected");

    const conflictErr = rejectedPromises[0].reason;
    assert.ok(conflictErr instanceof AppError, "Rejection reason must be an AppError");
    assert.strictEqual(conflictErr.statusCode, 409, "Conflict error must have statusCode 409");

    // Assert only 1 account transaction was added
    const endTxCount = mockAccountTransactions.length;
    assert.strictEqual(endTxCount, startTxCount + 1, "n. Exactly ONE AccountTransaction must be created");

    // Assert balance was decremented only once
    assert.strictEqual(
        validAccountA.currentBalance,
        startBalanceBeforeConcurrency - concurrentPayment.amount,
        "n. FinancialAccount balance must be decremented exactly once"
    );
    console.log("✅ m & n. Concurrent mark-paid atomicity & no duplicate records passed.");

    console.log("\n🎉 ALL PHASE 7 VENDOR PAYMENT MARK PAID & ACCOUNTING INTEGRATION TESTS PASSED SUCCESSFULLY!\n");
}

if (require.main === module) {
    runVendorPaymentMarkPaidTests()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error("❌ Test failed:", err);
            process.exit(1);
        });
}

module.exports = { runVendorPaymentMarkPaidTests };
