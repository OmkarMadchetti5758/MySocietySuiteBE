"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const BillingService = require("../modules/billing/billing.service");
const { BILLING_PERMISSIONS } = require("../common/billingPermissions");
const { hasBillingPermissionAsync } = require("../services/billingAuthorization.service");
const { requireBillingPermission } = require("../middleware/billingAuthorize.middleware");
const AppError = require("../common/AppError");

async function runVendorPaymentApproveRejectTests() {
    console.log("=========================================");
    console.log("Running Phase 6: Vendor Payment Approve & Reject Tests...");
    console.log("=========================================");

    const socAId = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad0000aa");
    const socBId = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad0000bb");

    const admin1Id = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000021");
    const admin2Id = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000022");
    const accountantId = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000010");
    const residentId = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000030");

    const mockPayments = [
        // 0: For test a & c (Approval)
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000041"),
            societyId: socAId,
            paymentNumber: "VP-2026-00041",
            amount: 15000,
            status: "pending_approval",
            requestedBy: accountantId,
            createdBy: accountantId,
            approvedBy: null,
            approvedAt: null,
            approvalComment: "",
            rejectedBy: null,
            rejectedAt: null,
            rejectionComment: "",
        },
        // 1: For test b & d (Rejection)
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000042"),
            societyId: socAId,
            paymentNumber: "VP-2026-00042",
            amount: 20000,
            status: "pending_approval",
            requestedBy: accountantId,
            createdBy: accountantId,
            approvedBy: null,
            approvedAt: null,
            approvalComment: "",
            rejectedBy: null,
            rejectedAt: null,
            rejectionComment: "",
        },
        // 2: For test g (Already approved)
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000043"),
            societyId: socAId,
            paymentNumber: "VP-2026-00043",
            amount: 10000,
            status: "approved",
            requestedBy: accountantId,
            createdBy: accountantId,
            approvedBy: admin1Id,
            approvedAt: new Date("2026-01-10"),
        },
        // 3: For test h (Already rejected)
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000044"),
            societyId: socAId,
            paymentNumber: "VP-2026-00044",
            amount: 8000,
            status: "rejected",
            requestedBy: accountantId,
            createdBy: accountantId,
            rejectedBy: admin1Id,
            rejectedAt: new Date("2026-01-11"),
            rejectionComment: "Duplicate submission",
        },
        // 4: For test i (Paid)
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000045"),
            societyId: socAId,
            paymentNumber: "VP-2026-00045",
            amount: 12000,
            status: "paid",
            requestedBy: accountantId,
            createdBy: accountantId,
            approvedBy: admin1Id,
            paidBy: accountantId,
            paidAt: new Date("2026-01-12"),
        },
        // 5: For test j (Cross-society payment in Society B)
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000046"),
            societyId: socBId,
            paymentNumber: "VP-2026-00046",
            amount: 9000,
            status: "pending_approval",
            requestedBy: accountantId,
            createdBy: accountantId,
            approvedBy: null,
        },
        // 6: For test k (Self-approval test: created by admin1)
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000047"),
            societyId: socAId,
            paymentNumber: "VP-2026-00047",
            amount: 18000,
            status: "pending_approval",
            requestedBy: admin1Id,
            createdBy: admin1Id,
            approvedBy: null,
        },
        // 7: For test l (Concurrency test)
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000048"),
            societyId: socAId,
            paymentNumber: "VP-2026-00048",
            amount: 25000,
            status: "pending_approval",
            requestedBy: accountantId,
            createdBy: accountantId,
            approvedBy: null,
        },
    ];

    const mockAuditLogs = [];

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

    const mockOpsDb = {
        models: {
            VendorPayment: mockVendorPaymentModel,
            BillingAuditLog: {
                async create(log) {
                    mockAuditLogs.push(log);
                    return log;
                },
            },
        },
        model(name) {
            return this.models[name];
        },
    };

    const adminReq1 = {
        user: {
            id: admin1Id,
            societyId: socAId,
            role: "admin",
            roleKeys: ["admin"],
        },
        opsDb: mockOpsDb,
    };

    const adminReq2 = {
        user: {
            id: admin2Id,
            societyId: socAId,
            role: "admin",
            roleKeys: ["admin"],
        },
        opsDb: mockOpsDb,
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

    const residentReq = {
        user: {
            id: residentId,
            societyId: socAId,
            role: "resident",
            roleKeys: ["resident"],
        },
        opsDb: mockOpsDb,
    };

    // ── a. Committee Admin can approve pending-approval Vendor Payment ─────────
    console.log("Testing a & c: Committee Admin can approve and store approvalComment...");
    const approved = await BillingService.approveVendorPayment(
        adminReq1,
        mockPayments[0]._id.toString(),
        "approve",
        "Verified and approved by Committee"
    );

    assert.ok(approved, "Payment should be approved");
    assert.strictEqual(approved.status, "approved", "Status must be 'approved'");
    assert.strictEqual(String(approved.approvedBy), String(admin1Id), "approvedBy must match approver ID");
    assert.ok(approved.approvedAt, "approvedAt must be set");
    assert.strictEqual(approved.approvalComment, "Verified and approved by Committee", "approvalComment must be stored");
    console.log("✅ a & c. Committee Admin approval & approvalComment passed.");

    // ── b. Committee Admin can reject pending-approval Vendor Payment ─────────
    console.log("Testing b & d: Committee Admin can reject and store rejectionComment...");
    const rejected = await BillingService.approveVendorPayment(
        adminReq1,
        mockPayments[1]._id.toString(),
        "reject",
        "Invoice details are incomplete"
    );

    assert.ok(rejected, "Payment should be rejected");
    assert.strictEqual(rejected.status, "rejected", "Status must be 'rejected'");
    assert.strictEqual(String(rejected.rejectedBy), String(admin1Id), "rejectedBy must match rejector ID");
    assert.ok(rejected.rejectedAt, "rejectedAt must be set");
    assert.strictEqual(rejected.rejectionComment, "Invoice details are incomplete", "rejectionComment must be stored");
    console.log("✅ b & d. Committee Admin rejection & rejectionComment passed.");

    // ── e. Unauthorized user cannot approve ───────────────────────────────────
    console.log("Testing e: Unauthorized user (Accountant / Resident) cannot approve...");
    // e1. Accountant does not have VENDOR_PAYMENT_APPROVE
    const accountantCanApprove = await hasBillingPermissionAsync(
        accountantReq.user,
        BILLING_PERMISSIONS.VENDOR_PAYMENT_APPROVE
    );
    assert.strictEqual(accountantCanApprove, false, "Accountant MUST NOT have VENDOR_PAYMENT_APPROVE permission");

    // e2. Resident does not have VENDOR_PAYMENT_APPROVE
    const residentCanApprove = await hasBillingPermissionAsync(
        residentReq.user,
        BILLING_PERMISSIONS.VENDOR_PAYMENT_APPROVE
    );
    assert.strictEqual(residentCanApprove, false, "Resident MUST NOT have VENDOR_PAYMENT_APPROVE permission");

    // e3. Middleware rejects with 403
    const middleware = requireBillingPermission(BILLING_PERMISSIONS.VENDOR_PAYMENT_APPROVE);
    let middlewareErr = null;
    await middleware(accountantReq, {}, (err) => {
        middlewareErr = err;
    });
    assert.ok(middlewareErr, "Middleware should reject accountant");
    assert.strictEqual(middlewareErr.statusCode, 403, "Middleware should return 403 for accountant");
    console.log("✅ e. Unauthorized user cannot approve (403) passed.");

    // ── f. Unauthorized user cannot reject ───────────────────────────────────
    console.log("Testing f: Unauthorized user cannot reject...");
    let rejectMiddlewareErr = null;
    await middleware(residentReq, {}, (err) => {
        rejectMiddlewareErr = err;
    });
    assert.ok(rejectMiddlewareErr, "Middleware should reject resident for rejection route");
    assert.strictEqual(rejectMiddlewareErr.statusCode, 403, "Middleware should return 403 for resident");
    console.log("✅ f. Unauthorized user cannot reject (403) passed.");

    // ── g. Already approved payment cannot be approved again ──────────────────
    console.log("Testing g: Already approved payment cannot be approved again...");
    try {
        await BillingService.approveVendorPayment(adminReq1, mockPayments[2]._id.toString(), "approve");
        assert.fail("Should throw 409 for already approved payment");
    } catch (err) {
        assert.strictEqual(err.statusCode, 409, "Already approved payment should throw 409");
        assert.strictEqual(mockPayments[2].status, "approved", "Status must remain approved");
        console.log("✅ g. Already approved payment rejection (409) passed.");
    }

    // ── h. Rejected payment cannot be approved ────────────────────────────────
    console.log("Testing h: Rejected payment cannot be approved...");
    try {
        await BillingService.approveVendorPayment(adminReq1, mockPayments[3]._id.toString(), "approve");
        assert.fail("Should throw 409 when attempting to approve a rejected payment");
    } catch (err) {
        assert.strictEqual(err.statusCode, 409, "Rejected payment should throw 409");
        assert.strictEqual(mockPayments[3].status, "rejected", "Status must remain rejected");
        console.log("✅ h. Rejected payment cannot be approved (409) passed.");
    }

    // ── i. Paid payment cannot be approved or rejected ────────────────────────
    console.log("Testing i: Paid payment cannot be approved or rejected...");
    try {
        await BillingService.approveVendorPayment(adminReq1, mockPayments[4]._id.toString(), "approve");
        assert.fail("Should throw 409 when attempting to approve paid payment");
    } catch (err) {
        assert.strictEqual(err.statusCode, 409);
    }
    try {
        await BillingService.approveVendorPayment(adminReq1, mockPayments[4]._id.toString(), "reject");
        assert.fail("Should throw 409 when attempting to reject paid payment");
    } catch (err) {
        assert.strictEqual(err.statusCode, 409);
    }
    assert.strictEqual(mockPayments[4].status, "paid", "Status must remain paid");
    console.log("✅ i. Paid payment cannot be approved or rejected (409) passed.");

    // ── j. Cross-society payment cannot be approved or rejected ───────────────
    console.log("Testing j: Cross-society payment cannot be approved or rejected...");
    try {
        await BillingService.approveVendorPayment(adminReq1, mockPayments[5]._id.toString(), "approve");
        assert.fail("Cross-society payment approval should fail with 404");
    } catch (err) {
        assert.strictEqual(err.statusCode, 404, "Cross-society payment must throw 404");
        assert.strictEqual(err.message, "Vendor payment not found.");
    }
    try {
        await BillingService.approveVendorPayment(adminReq1, mockPayments[5]._id.toString(), "reject");
        assert.fail("Cross-society payment rejection should fail with 404");
    } catch (err) {
        assert.strictEqual(err.statusCode, 404, "Cross-society payment must throw 404");
    }
    assert.strictEqual(mockPayments[5].status, "pending_approval", "Cross-society payment must remain unchanged");
    console.log("✅ j. Cross-society payment isolation (404) passed.");

    // ── k. Self-approval protection works ─────────────────────────────────────
    console.log("Testing k: Self-approval protection works...");
    try {
        // admin1 created this payment, so admin1 cannot approve it
        await BillingService.approveVendorPayment(adminReq1, mockPayments[6]._id.toString(), "approve");
        assert.fail("Creator must not be able to self-approve");
    } catch (err) {
        assert.strictEqual(err.statusCode, 403, "Self-approval must return 403");
        assert.strictEqual(err.message, "Self-approval is forbidden. Another Committee Admin must approve.");
        // Verify payment remained pending_approval
        assert.strictEqual(mockPayments[6].status, "pending_approval", "Status must remain pending_approval after self-approval attempt");
        assert.strictEqual(mockPayments[6].approvedBy, null, "approvedBy must be rolled back to null");
    }

    // Now verify that a DIFFERENT Committee Admin (admin2) CAN approve it!
    const approvedByOtherAdmin = await BillingService.approveVendorPayment(
        adminReq2,
        mockPayments[6]._id.toString(),
        "approve",
        "Approved by co-admin"
    );
    assert.strictEqual(approvedByOtherAdmin.status, "approved", "Different Committee Admin should approve");
    assert.strictEqual(String(approvedByOtherAdmin.approvedBy), String(admin2Id));
    console.log("✅ k. Self-approval prevention & co-admin approval passed.");

    // ── l. Concurrent approval requests ───────────────────────────────────────
    console.log("Testing l: Concurrent approval requests...");
    // Simulate atomic concurrency:
    // In our atomic findOneAndUpdate, only the first request matches status: "pending_approval".
    // The second request finds status is already "approved" and throws 409.
    const concurrentTargetId = mockPayments[7]._id.toString();

    let successCount = 0;
    let conflictCount = 0;

    const [res1, res2] = await Promise.allSettled([
        BillingService.approveVendorPayment(adminReq1, concurrentTargetId, "approve", "Admin 1 Approval"),
        BillingService.approveVendorPayment(adminReq2, concurrentTargetId, "approve", "Admin 2 Approval"),
    ]);

    if (res1.status === "fulfilled") successCount++;
    else if (res1.reason?.statusCode === 409) conflictCount++;

    if (res2.status === "fulfilled") successCount++;
    else if (res2.reason?.statusCode === 409) conflictCount++;

    assert.strictEqual(successCount, 1, "Exactly one approval request must succeed");
    assert.strictEqual(conflictCount, 1, "Exactly one approval request must receive 409 conflict");
    assert.strictEqual(mockPayments[7].status, "approved", "Final status must be 'approved'");
    console.log("✅ l. Concurrent approval atomicity (1 success, 1 conflict) passed.");

    console.log("\n🎉 ALL 12 PHASE 6 VENDOR PAYMENT APPROVE & REJECT TESTS PASSED SUCCESSFULLY!\n");
}

if (require.main === module) {
    runVendorPaymentApproveRejectTests().catch((err) => {
        console.error("❌ TEST FAILED:", err);
        process.exit(1);
    });
}

module.exports = { runVendorPaymentApproveRejectTests };
