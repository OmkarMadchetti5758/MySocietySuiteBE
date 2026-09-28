"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const BillingService = require("../modules/billing/billing.service");
const { BILLING_PERMISSIONS } = require("../common/billingPermissions");
const { hasBillingPermissionAsync } = require("../services/billingAuthorization.service");

async function runVendorPaymentE2EWorkflowTests() {
    console.log("=================================================");
    console.log("Running Final E2E Scenarios (Scenarios 1 through 6)...");
    console.log("=================================================");

    const socAId = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad0000a1");
    const socBId = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad0000b1");

    const committeeAdminId = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000011");
    const accountantId = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000012");
    const residentId = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000013");

    const vendorA = {
        _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000041"),
        societyId: socAId,
        vendorName: "Apex Security & Facility Services",
        status: "ACTIVE",
    };

    const bankAccountA = {
        _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000051"),
        societyId: socAId,
        accountName: "Society Primary Operating Bank",
        accountType: "BANK",
        accountNumber: "9876543210",
        openingBalance: 250000,
        currentBalance: 250000,
        status: "ACTIVE",
        async save() {
            return this;
        },
    };

    const paymentsStore = [];
    const transactionsStore = [];
    const auditLogsStore = [];

    const mockVendorModel = {
        findById(id) {
            const v = String(vendorA._id) === String(id) ? vendorA : null;
            return {
                lean: async () => (v ? { ...v } : null),
                then: (resolve) => resolve(v ? { ...v } : null),
            };
        },
        findOne(query) {
            const v = (String(vendorA._id) === String(query._id) && String(vendorA.societyId) === String(query.societyId)) ? vendorA : null;
            return {
                lean: async () => (v ? { ...v } : null),
                then: (resolve) => resolve(v ? { ...v } : null),
            };
        },
    };

    const mockVendorPaymentModel = {
        async countDocuments(query) {
            return paymentsStore.filter((p) => {
                if (query && query.societyId && String(p.societyId) !== String(query.societyId)) return false;
                return true;
            }).length;
        },
        async create(doc) {
            const item = {
                _id: new mongoose.Types.ObjectId(),
                ...doc,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            paymentsStore.push(item);
            return item;
        },
        async findOneAndUpdate(query, update) {
            const item = paymentsStore.find((p) => {
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
            const item = paymentsStore.find((p) => String(p._id) === String(query._id));
            if (item && update.$set) {
                Object.assign(item, update.$set);
            }
            return { modifiedCount: item ? 1 : 0 };
        },
        findOne(query) {
            const item = paymentsStore.find((p) => {
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
        findById(id) {
            const acc = String(bankAccountA._id) === String(id) ? bankAccountA : null;
            return {
                lean: async () => (acc ? { ...acc } : null),
                then: (resolve) => resolve(acc),
            };
        },
        findOne(query) {
            let match = true;
            if (query._id && String(bankAccountA._id) !== String(query._id)) match = false;
            if (query.societyId && String(bankAccountA.societyId) !== String(query.societyId)) match = false;
            const acc = match ? bankAccountA : null;
            return {
                lean: async () => (acc ? { ...acc } : null),
                then: (resolve) => resolve(acc),
            };
        },
        async updateOne(query, update) {
            if (String(bankAccountA._id) === String(query._id)) {
                if (update.$set) Object.assign(bankAccountA, update.$set);
                return { modifiedCount: 1 };
            }
            return { modifiedCount: 0 };
        },
    };

    const mockAccountTransactionModel = {
        async create(doc) {
            const item = { _id: new mongoose.Types.ObjectId(), ...doc, createdAt: new Date() };
            transactionsStore.push(item);
            return item;
        },
    };

    const mockAuditLogModel = {
        async create(log) {
            auditLogsStore.push(log);
            return log;
        },
    };

    const mockBillingConfigModel = {
        findOne() {
            return {
                lean: async () => ({ accountantApprovalThreshold: 10000 }),
                then: (resolve) => resolve({ accountantApprovalThreshold: 10000 }),
            };
        },
    };

    const mockOpsDbA = {
        models: {
            Vendor: mockVendorModel,
            VendorPayment: mockVendorPaymentModel,
            FinancialAccount: mockFinancialAccountModel,
            AccountTransaction: mockAccountTransactionModel,
            BillingAuditLog: mockAuditLogModel,
            AuditLog: mockAuditLogModel,
            BillingConfig: mockBillingConfigModel,
        },
        model(name) {
            return this.models[name];
        },
    };

    const mockOpsDbB = {
        models: {
            Vendor: { findOne: () => ({ lean: async () => null, then: (res) => res(null) }) },
            VendorPayment: mockVendorPaymentModel,
            FinancialAccount: { findOne: async () => null },
            AccountTransaction: mockAccountTransactionModel,
            BillingAuditLog: mockAuditLogModel,
            AuditLog: mockAuditLogModel,
            BillingConfig: mockBillingConfigModel,
        },
        model(name) {
            return this.models[name];
        },
    };

    const adminReqA = {
        user: { id: committeeAdminId, societyId: socAId, role: "admin", roleKeys: ["admin"] },
        opsDb: mockOpsDbA,
    };

    const accountantReqA = {
        user: { id: accountantId, societyId: socAId, role: "accountant", roleKeys: ["accountant"] },
        opsDb: mockOpsDbA,
    };

    const residentReqA = {
        user: { id: residentId, societyId: socAId, role: "resident", roleKeys: ["resident"] },
        opsDb: mockOpsDbA,
    };

    const adminReqB = {
        user: { id: new mongoose.Types.ObjectId(), societyId: socBId, role: "admin", roleKeys: ["admin"] },
        opsDb: mockOpsDbB,
    };

    // -------------------------------------------------------------
    // SCENARIO 1:
    // Create payment above threshold -> pending_approval
    // Committee Admin opens payment -> Approve -> approved
    // Mark Paid -> paid -> FinancialAccount updated -> AccountTransaction exists
    // -------------------------------------------------------------
    console.log("Testing Scenario 1: Complete Happy Path (Above threshold -> Pending -> Approved -> Paid)...");
    {
        // 1. Accountant creates payment above threshold (₹25,000 > ₹10,000)
        const payment = await BillingService.createVendorPayment(accountantReqA, {
            vendorId: vendorA._id,
            billReference: "INV-2026-001",
            amount: 25000,
            paymentMode: "bank_transfer",
            financialAccountId: bankAccountA._id,
            description: "Lift monthly AMC maintenance invoice",
        });

        assert.strictEqual(payment.status, "pending_approval", "Above threshold payment must be pending_approval");
        assert.strictEqual(payment.approvalRequired, true, "approvalRequired must be true");

        // 2. View details
        const details = await BillingService.getVendorPaymentById(adminReqA, payment._id.toString());
        assert.strictEqual(String(details._id), String(payment._id), "Details must match created payment");

        // 3. Committee Admin Approves
        const approvedPayment = await BillingService.approveVendorPayment(
            adminReqA,
            payment._id.toString(),
            "approve",
            "Verified against service report and approved."
        );

        assert.strictEqual(approvedPayment.status, "approved", "Status must become approved");
        assert.strictEqual(approvedPayment.approvalComment, "Verified against service report and approved.");
        assert.strictEqual(String(approvedPayment.approvedBy), String(committeeAdminId));

        // 4. Mark Paid
        const initialBalance = bankAccountA.currentBalance;
        const paidPayment = await BillingService.markVendorPaymentPaid(
            accountantReqA,
            payment._id.toString()
        );

        assert.strictEqual(paidPayment.status, "paid", "Status must become paid");
        assert.strictEqual(String(paidPayment.paidBy), String(accountantId));
        assert.ok(paidPayment.paidAt instanceof Date, "paidAt must be recorded");

        // 5. Verify FinancialAccount and AccountTransaction
        assert.strictEqual(bankAccountA.currentBalance, initialBalance - 25000, "Bank balance must be decremented by ₹25,000");
        const tx = transactionsStore.find((t) => String(t.referenceId) === String(payment._id));
        assert.ok(tx, "AccountTransaction must be created with payment reference");
        assert.strictEqual(tx.direction, "DEBIT", "AccountTransaction direction must be DEBIT");
        assert.strictEqual(tx.amount, 25000, "AccountTransaction amount must match ₹25,000");

        console.log("✅ Scenario 1 passed successfully.");
    }

    // -------------------------------------------------------------
    // SCENARIO 2:
    // Create payment above threshold -> pending_approval
    // Reject -> rejected -> Approve unavailable -> Mark Paid unavailable
    // -------------------------------------------------------------
    console.log("Testing Scenario 2: Rejection Flow (Above threshold -> Pending -> Rejected -> No Approve / No Mark Paid)...");
    {
        const payment = await BillingService.createVendorPayment(accountantReqA, {
            vendorId: vendorA._id,
            billReference: "INV-2026-002",
            amount: 50000,
            paymentMode: "bank_transfer",
            financialAccountId: bankAccountA._id,
            description: "Unverified generator overhaul",
        });

        assert.strictEqual(payment.status, "pending_approval");

        // Committee Admin rejects
        const rejected = await BillingService.approveVendorPayment(
            adminReqA,
            payment._id.toString(),
            "reject",
            "Vendor quotes do not match purchase order."
        );

        assert.strictEqual(rejected.status, "rejected");
        assert.strictEqual(rejected.rejectionComment, "Vendor quotes do not match purchase order.");

        // Attempt to Approve rejected payment -> must fail with 409
        let approveErr = null;
        try {
            await BillingService.approveVendorPayment(
                adminReqA,
                payment._id.toString(),
                "approve",
                "Trying to approve rejected"
            );
        } catch (e) {
            approveErr = e;
        }
        assert.ok(approveErr && approveErr.statusCode === 409, "Rejected payment cannot be approved");

        // Attempt to Mark Paid rejected payment -> must fail with 409
        let markPaidErr = null;
        try {
            await BillingService.markVendorPaymentPaid(accountantReqA, payment._id.toString());
        } catch (e) {
            markPaidErr = e;
        }
        assert.ok(markPaidErr && markPaidErr.statusCode === 409, "Rejected payment cannot be marked paid");

        console.log("✅ Scenario 2 passed successfully.");
    }

    // -------------------------------------------------------------
    // SCENARIO 3:
    // Unauthorized user (Resident) cannot approve, reject, or mark paid
    // -------------------------------------------------------------
    console.log("Testing Scenario 3: Unauthorized user (Resident) blocked by authorization system...");
    {
        const canApprove = await hasBillingPermissionAsync(
            residentReqA.user,
            BILLING_PERMISSIONS.VENDOR_PAYMENT_APPROVE
        );
        assert.strictEqual(canApprove, false, "Resident cannot have VENDOR_PAYMENT_APPROVE permission");

        const canMarkPaid = await hasBillingPermissionAsync(
            residentReqA.user,
            BILLING_PERMISSIONS.VENDOR_PAYMENT_MARK_PAID
        );
        assert.strictEqual(canMarkPaid, false, "Resident cannot have VENDOR_PAYMENT_MARK_PAID permission");

        const canCreate = await hasBillingPermissionAsync(
            residentReqA.user,
            BILLING_PERMISSIONS.VENDOR_PAYMENT_CREATE
        );
        assert.strictEqual(canCreate, false, "Resident cannot have VENDOR_PAYMENT_CREATE permission");

        const { requireBillingPermission } = require("../middleware/billingAuthorize.middleware");
        const approveMiddleware = requireBillingPermission(BILLING_PERMISSIONS.VENDOR_PAYMENT_APPROVE);
        let middlewareErr = null;
        await approveMiddleware(residentReqA, {}, (err) => {
            middlewareErr = err;
        });
        assert.ok(middlewareErr && middlewareErr.statusCode === 403, "Middleware rejects resident with 403");

        const markPaidMiddleware = requireBillingPermission(BILLING_PERMISSIONS.VENDOR_PAYMENT_MARK_PAID);
        let markPaidMiddlewareErr = null;
        await markPaidMiddleware(residentReqA, {}, (err) => {
            markPaidMiddlewareErr = err;
        });
        assert.ok(markPaidMiddlewareErr && markPaidMiddlewareErr.statusCode === 403, "Middleware rejects resident with 403 for mark paid");

        console.log("✅ Scenario 3 passed successfully.");
    }

    // -------------------------------------------------------------
    // SCENARIO 4:
    // Cross-society payment isolation
    // -------------------------------------------------------------
    console.log("Testing Scenario 4: Cross-society payment cannot be accessed or modified...");
    {
        // Payment exists in Soc A. User in Soc B tries to access
        let crossGetErr = null;
        try {
            await BillingService.getVendorPaymentById(adminReqB, paymentsStore[0]._id.toString());
        } catch (e) {
            crossGetErr = e;
        }
        assert.ok(crossGetErr && crossGetErr.statusCode === 404, "Cross-society payment details must return 404");

        let crossApproveErr = null;
        try {
            await BillingService.approveVendorPayment(adminReqB, paymentsStore[0]._id.toString(), "approve", "Cross");
        } catch (e) {
            crossApproveErr = e;
        }
        assert.ok(crossApproveErr && crossApproveErr.statusCode === 404, "Cross-society payment approval must return 404");

        let crossMarkPaidErr = null;
        try {
            await BillingService.markVendorPaymentPaid(adminReqB, paymentsStore[0]._id.toString());
        } catch (e) {
            crossMarkPaidErr = e;
        }
        assert.ok(crossMarkPaidErr && crossMarkPaidErr.statusCode === 404, "Cross-society payment mark-paid must return 404");

        console.log("✅ Scenario 4 passed successfully.");
    }

    // -------------------------------------------------------------
    // SCENARIO 5:
    // Already paid payment -> no duplicate Mark Paid -> no duplicate AccountTransaction
    // -------------------------------------------------------------
    console.log("Testing Scenario 5: Already paid payment protection against duplicates...");
    {
        // paymentsStore[0] is already paid from Scenario 1
        const targetPayment = paymentsStore[0];
        assert.strictEqual(targetPayment.status, "paid");

        const txCountBefore = transactionsStore.length;
        const balanceBefore = bankAccountA.currentBalance;

        let dupErr = null;
        try {
            await BillingService.markVendorPaymentPaid(accountantReqA, targetPayment._id.toString());
        } catch (e) {
            dupErr = e;
        }

        assert.ok(dupErr && dupErr.statusCode === 409, "Second mark-paid attempt must fail with 409 Conflict");
        assert.strictEqual(transactionsStore.length, txCountBefore, "No duplicate AccountTransaction created");
        assert.strictEqual(bankAccountA.currentBalance, balanceBefore, "Bank balance not double-debited");

        console.log("✅ Scenario 5 passed successfully.");
    }

    // -------------------------------------------------------------
    // SCENARIO 6:
    // Double-click / concurrent action -> atomic update prevents duplicate transition
    // -------------------------------------------------------------
    console.log("Testing Scenario 6: Concurrent action atomicity & double-click protection...");
    {
        // Create new approved payment
        const payment = await BillingService.createVendorPayment(accountantReqA, {
            vendorId: vendorA._id,
            billReference: "INV-CONCURRENT",
            amount: 8000,
            paymentMode: "bank_transfer",
            financialAccountId: bankAccountA._id,
        });

        await BillingService.approveVendorPayment(
            adminReqA,
            payment._id.toString(),
            "approve",
            "Approved for concurrency test"
        );

        // Fire two mark-paid requests concurrently
        const results = await Promise.allSettled([
            BillingService.markVendorPaymentPaid(accountantReqA, payment._id.toString()),
            BillingService.markVendorPaymentPaid(accountantReqA, payment._id.toString()),
        ]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");

        assert.strictEqual(fulfilled.length, 1, "Exactly one concurrent request must succeed");
        assert.strictEqual(rejected.length, 1, "Exactly one concurrent request must be rejected");
        assert.strictEqual(rejected[0].reason.statusCode, 409, "Rejected concurrent request must have status code 409 Conflict");

        console.log("✅ Scenario 6 passed successfully.");
    }

    console.log("\n🎉 ALL 6 E2E VENDOR PAYMENT SCENARIOS PASSED WITH 100% SUCCESS!\n");
}

runVendorPaymentE2EWorkflowTests()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("Test failure:", err);
        process.exit(1);
    });
