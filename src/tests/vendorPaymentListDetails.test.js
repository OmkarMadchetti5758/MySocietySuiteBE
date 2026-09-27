"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const BillingService = require("../modules/billing/billing.service");
const { BILLING_PERMISSIONS } = require("../common/billingPermissions");
const { hasBillingPermissionAsync } = require("../services/billingAuthorization.service");
const { requireBillingPermission } = require("../middleware/billingAuthorize.middleware");
const AppError = require("../common/AppError");

async function runVendorPaymentListDetailsTests() {
    console.log("=========================================");
    console.log("Running Phase 5: Vendor Payment List & Details Tests...");
    console.log("=========================================");

    const socAId = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad0000aa");
    const socBId = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad0000bb");

    const vendor1Id = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000001");
    const vendor2Id = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000002");
    const vendorBId = new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000003");

    const mockPayments = [
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000011"),
            societyId: socAId,
            paymentNumber: "VP-2026-00001",
            vendorId: vendor1Id,
            vendorName: "Apex Plumbing Services",
            billReference: "INV-001",
            amount: 3000,
            paymentMode: "bank_transfer",
            status: "approved",
            approvalRequired: false,
            requestedBy: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000091"),
            createdBy: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000091"),
            approvedBy: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000091"),
            createdAt: new Date("2026-01-10T10:00:00Z"),
        },
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000012"),
            societyId: socAId,
            paymentNumber: "VP-2026-00002",
            vendorId: vendor1Id,
            vendorName: "Apex Plumbing Services",
            billReference: "INV-002",
            amount: 8000,
            paymentMode: "bank_transfer",
            status: "pending_approval",
            approvalRequired: true,
            requestedBy: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000091"),
            createdBy: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000091"),
            approvedBy: null,
            createdAt: new Date("2026-01-15T10:00:00Z"),
        },
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000013"),
            societyId: socAId,
            paymentNumber: "VP-2026-00003",
            vendorId: vendor2Id,
            vendorName: "Metro Security Systems",
            billReference: "INV-003",
            amount: 15000,
            paymentMode: "cheque",
            status: "pending_approval",
            approvalRequired: true,
            requestedBy: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000091"),
            createdBy: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000091"),
            approvedBy: null,
            createdAt: new Date("2026-01-20T10:00:00Z"),
        },
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000014"),
            societyId: socAId,
            paymentNumber: "VP-2026-00004",
            vendorId: vendor2Id,
            vendorName: "Metro Security Systems",
            billReference: "INV-004",
            amount: 25000,
            paymentMode: "bank_transfer",
            status: "approved",
            approvalRequired: false,
            requestedBy: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000091"),
            createdBy: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000091"),
            approvedBy: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000091"),
            createdAt: new Date("2026-01-25T10:00:00Z"),
        },
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000015"),
            societyId: socAId,
            paymentNumber: "VP-2026-00005",
            vendorId: vendor1Id,
            vendorName: "Apex Plumbing Services",
            billReference: "INV-005",
            amount: 1000,
            paymentMode: "cash",
            status: "rejected",
            approvalRequired: false,
            requestedBy: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000091"),
            createdBy: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000091"),
            approvedBy: null,
            createdAt: new Date("2026-02-01T10:00:00Z"),
        },
        // Cross-society record (Society B)
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000019"),
            societyId: socBId,
            paymentNumber: "VP-2026-00099",
            vendorId: vendorBId,
            vendorName: "Cross Society Vendor",
            billReference: "INV-SOCB",
            amount: 5000,
            paymentMode: "bank_transfer",
            status: "approved",
            approvalRequired: false,
            requestedBy: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000092"),
            createdBy: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000092"),
            approvedBy: null,
            createdAt: new Date("2026-01-12T10:00:00Z"),
        },
    ];

    function applyFilter(item, filter) {
        if (filter.societyId && String(item.societyId) !== String(filter.societyId)) {
            return false;
        }
        if (filter._id && String(item._id) !== String(filter._id)) {
            return false;
        }
        if (filter.status) {
            if (filter.status.$in) {
                if (!filter.status.$in.includes(item.status.toLowerCase()) && !filter.status.$in.includes(item.status.toUpperCase())) {
                    return false;
                }
            } else if (item.status.toLowerCase() !== filter.status.toLowerCase()) {
                return false;
            }
        }
        if (filter.vendorId && String(item.vendorId) !== String(filter.vendorId)) {
            return false;
        }
        if (filter.createdAt) {
            if (filter.createdAt.$gte && item.createdAt < filter.createdAt.$gte) {
                return false;
            }
            if (filter.createdAt.$lte && item.createdAt > filter.createdAt.$lte) {
                return false;
            }
        }
        if (filter.$or) {
            const matches = filter.$or.some((cond) => {
                if (cond.paymentNumber && cond.paymentNumber.test(item.paymentNumber)) return true;
                if (cond.vendorName && cond.vendorName.test(item.vendorName)) return true;
                if (cond.billReference && cond.billReference.test(item.billReference)) return true;
                return false;
            });
            if (!matches) return false;
        }
        return true;
    }

    const mockVendorPaymentModel = {
        find(filter = {}) {
            let res = mockPayments.filter((p) => applyFilter(p, filter));
            // Default sort: createdAt desc
            res.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

            return {
                sort(sortObj) {
                    return this;
                },
                skip(skipCount) {
                    res = res.slice(skipCount);
                    return this;
                },
                limit(limitCount) {
                    res = res.slice(0, limitCount);
                    return this;
                },
                lean: async () => res.map((r) => ({ ...r })),
            };
        },
        async countDocuments(filter = {}) {
            return mockPayments.filter((p) => applyFilter(p, filter)).length;
        },
        findOne(query = {}) {
            const found = mockPayments.find((p) => applyFilter(p, query));
            return {
                lean: async () => (found ? { ...found } : null),
                then: (resolve) => resolve(found ? { ...found } : null),
            };
        },
    };

    const mockOpsDb = {
        models: {
            VendorPayment: mockVendorPaymentModel,
            BillingAuditLog: {
                async create(doc) { return doc; }
            },
        },
        model(name) {
            return this.models[name];
        },
    };

    const accountantReq = {
        user: {
            id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000091"),
            societyId: socAId,
            role: "accountant",
            roleKeys: ["accountant"],
        },
        opsDb: mockOpsDb,
    };

    const adminReq = {
        user: {
            id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000090"),
            societyId: socAId,
            role: "admin",
            roleKeys: ["admin"],
        },
        opsDb: mockOpsDb,
    };

    const residentReq = {
        user: {
            id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000099"),
            societyId: socAId,
            role: "resident",
            roleKeys: ["resident"],
        },
        opsDb: mockOpsDb,
    };

    // ── 1. Authorized user can list payments ──────────────────────────────────
    console.log("Testing 1. Authorized user can list payments...");
    const listResult = await BillingService.getVendorPayments(accountantReq, {});
    assert.ok(listResult.payments, "Result should contain payments array");
    assert.strictEqual(listResult.payments.length, 5, "Should list exactly 5 payments for Society A");
    assert.strictEqual(listResult.pagination.total, 5, "Total count should be 5");
    assert.ok(listResult.payments[0].paymentNumber, "Payment should contain paymentNumber");
    assert.ok(listResult.payments[0].vendorName, "Payment should contain vendorName");
    console.log("✅ 1. Authorized user can list payments passed.");

    // ── 2. Authorized user can get payment details ────────────────────────────
    console.log("Testing 2. Authorized user can get payment details...");
    const details = await BillingService.getVendorPaymentById(accountantReq, mockPayments[0]._id.toString());
    assert.ok(details, "Details should be returned");
    assert.strictEqual(details.paymentNumber, "VP-2026-00001");
    assert.strictEqual(details.vendorName, "Apex Plumbing Services");
    assert.strictEqual(details.amount, 3000);
    assert.strictEqual(details.status, "approved");
    console.log("✅ 2. Authorized user can get payment details passed.");

    // ── 3. Resident / unauthorized user is rejected ───────────────────────────
    console.log("Testing 3. Resident / unauthorized user is rejected...");
    const residentCanView = await hasBillingPermissionAsync(residentReq.user, BILLING_PERMISSIONS.VENDOR_PAYMENT_VIEW);
    assert.strictEqual(residentCanView, false, "Resident must not have VENDOR_PAYMENT_VIEW permission");

    const middleware = requireBillingPermission(BILLING_PERMISSIONS.VENDOR_PAYMENT_VIEW);
    let middlewareErr = null;
    await middleware(residentReq, {}, (err) => {
        middlewareErr = err;
    });
    assert.ok(middlewareErr, "Middleware should reject resident");
    assert.strictEqual(middlewareErr.statusCode, 403, "Middleware should return 403 Forbidden");
    console.log("✅ 3. Resident / unauthorized user rejected (403) passed.");

    // ── 4. Payment from another society cannot be accessed ────────────────────
    console.log("Testing 4. Payment from another society cannot be accessed...");
    try {
        await BillingService.getVendorPaymentById(accountantReq, mockPayments[5]._id.toString());
        assert.fail("Should not allow accessing another society's payment");
    } catch (err) {
        assert.strictEqual(err.statusCode, 404, "Cross-society payment should return 404 (not leak existence)");
        assert.strictEqual(err.message, "Vendor payment not found.");
        console.log("✅ 4. Cross-society payment isolation passed.");
    }

    // ── 5. Invalid payment ID returns 400 ─────────────────────────────────────
    console.log("Testing 5. Invalid payment ID returns 400...");
    try {
        await BillingService.getVendorPaymentById(accountantReq, "invalid-mongo-id");
        assert.fail("Should throw 400 for malformed payment ID");
    } catch (err) {
        assert.strictEqual(err.statusCode, 400, "Malformed payment ID should return 400");
        assert.strictEqual(err.message, "Invalid vendor payment ID format.");
        console.log("✅ 5. Invalid payment ID returns 400 passed.");
    }

    // ── 6. Non-existent payment returns 404 ───────────────────────────────────
    console.log("Testing 6. Non-existent payment returns 404...");
    try {
        await BillingService.getVendorPaymentById(accountantReq, "60c72b2f9b1d8b2bad000088");
        assert.fail("Should throw 404 for non-existent payment ID");
    } catch (err) {
        assert.strictEqual(err.statusCode, 404, "Non-existent payment should return 404");
        assert.strictEqual(err.message, "Vendor payment not found.");
        console.log("✅ 6. Non-existent payment returns 404 passed.");
    }

    // ── 7. Status filter works ────────────────────────────────────────────────
    console.log("Testing 7. Status filter works...");
    // 7a. Pending approval
    const pendingResult = await BillingService.getVendorPayments(accountantReq, { status: "pending_approval" });
    assert.strictEqual(pendingResult.payments.length, 2, "Should return 2 pending_approval payments");
    assert.ok(pendingResult.payments.every((p) => p.status === "pending_approval"));

    // 7b. Approved
    const approvedResult = await BillingService.getVendorPayments(accountantReq, { status: "approved" });
    assert.strictEqual(approvedResult.payments.length, 2, "Should return 2 approved payments");
    assert.ok(approvedResult.payments.every((p) => p.status === "approved"));

    // 7c. Rejected
    const rejectedResult = await BillingService.getVendorPayments(accountantReq, { status: "rejected" });
    assert.strictEqual(rejectedResult.payments.length, 1, "Should return 1 rejected payment");
    assert.strictEqual(rejectedResult.payments[0].paymentNumber, "VP-2026-00005");
    console.log("✅ 7. Status filter works passed.");

    // ── 8. Vendor filter works ────────────────────────────────────────────────
    console.log("Testing 8. Vendor filter works...");
    // 8a. Filter by vendor1
    const v1Result = await BillingService.getVendorPayments(accountantReq, { vendorId: vendor1Id.toString() });
    assert.strictEqual(v1Result.payments.length, 3, "Should return 3 payments for vendor 1");
    assert.ok(v1Result.payments.every((p) => String(p.vendorId) === String(vendor1Id)));

    // 8b. Filter by vendor2
    const v2Result = await BillingService.getVendorPayments(accountantReq, { vendorId: vendor2Id.toString() });
    assert.strictEqual(v2Result.payments.length, 2, "Should return 2 payments for vendor 2");
    assert.ok(v2Result.payments.every((p) => String(p.vendorId) === String(vendor2Id)));
    console.log("✅ 8. Vendor filter works passed.");

    // ── 9. Pagination works ───────────────────────────────────────────────────
    console.log("Testing 9. Pagination works...");
    // Page 1, limit 2
    const p1Result = await BillingService.getVendorPayments(accountantReq, { page: 1, limit: 2 });
    assert.strictEqual(p1Result.payments.length, 2, "Page 1 should have 2 payments");
    assert.strictEqual(p1Result.pagination.total, 5, "Total count should be 5");
    assert.strictEqual(p1Result.pagination.pages, 3, "Pages should be 3");
    assert.strictEqual(p1Result.pagination.page, 1);
    assert.strictEqual(p1Result.pagination.limit, 2);

    // Page 2, limit 2
    const p2Result = await BillingService.getVendorPayments(accountantReq, { page: 2, limit: 2 });
    assert.strictEqual(p2Result.payments.length, 2, "Page 2 should have 2 payments");
    assert.strictEqual(p2Result.pagination.page, 2);
    // Ensure distinct payments across pages
    assert.notStrictEqual(p1Result.payments[0]._id.toString(), p2Result.payments[0]._id.toString());

    // Page 3, limit 2 (last page)
    const p3Result = await BillingService.getVendorPayments(accountantReq, { page: 3, limit: 2 });
    assert.strictEqual(p3Result.payments.length, 1, "Page 3 should have 1 payment remaining");
    assert.strictEqual(p3Result.pagination.page, 3);
    console.log("✅ 9. Pagination works passed.");

    // ── 10. Existing Billing Access Matrix tests verification ─────────────────
    console.log("Testing 10. Verification of Billing Access Matrix compatibility...");
    const adminCanView = await hasBillingPermissionAsync(adminReq.user, BILLING_PERMISSIONS.VENDOR_PAYMENT_VIEW);
    assert.strictEqual(adminCanView, true, "Admin has VENDOR_PAYMENT_VIEW");
    const acctCanView = await hasBillingPermissionAsync(accountantReq.user, BILLING_PERMISSIONS.VENDOR_PAYMENT_VIEW);
    assert.strictEqual(acctCanView, true, "Accountant has VENDOR_PAYMENT_VIEW");
    console.log("✅ 10. Existing Billing Access Matrix compatibility verified.");

    console.log("\n🎉 ALL 10 PHASE 5 VENDOR PAYMENT LIST & DETAILS TESTS PASSED SUCCESSFULLY!\n");
}

if (require.main === module) {
    runVendorPaymentListDetailsTests().catch((err) => {
        console.error("❌ TEST FAILED:", err);
        process.exit(1);
    });
}

module.exports = { runVendorPaymentListDetailsTests };
