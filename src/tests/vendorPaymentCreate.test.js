"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const BillingService = require("../modules/billing/billing.service");
const { BILLING_PERMISSIONS } = require("../common/billingPermissions");
const { hasBillingPermissionAsync } = require("../services/billingAuthorization.service");
const { requireBillingPermission } = require("../middleware/billingAuthorize.middleware");
const AppError = require("../common/AppError");

async function runVendorPaymentCreateTests() {
    console.log("=========================================");
    console.log("Running Phase 4: Create Vendor Payment Tests...");
    console.log("=========================================");

    // In-memory data store for testing
    const vendors = [
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000001"),
            societyId: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad0000aa"),
            name: "Apex Plumbing Services",
            serviceCategory: "Plumbing",
            status: "ACTIVE",
        },
        {
            _id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000002"),
            societyId: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad0000bb"), // Different society
            name: "Blue Star Electricals",
            serviceCategory: "Electrical",
            status: "ACTIVE",
        },
    ];

    const mockPayments = [];
    const mockAuditLogs = [];
    const mockSocietyAId = vendors[0].societyId; // 60c72b2f9b1d8b2bad0000aa
    const mockSocietyBId = vendors[1].societyId; // 60c72b2f9b1d8b2bad0000bb

    const mockVendorModel = {
        findById(id) {
            const found = vendors.find((v) => String(v._id) === String(id));
            return {
                lean: async () => (found ? { ...found } : null),
                then: (resolve) => resolve(found ? { ...found } : null),
            };
        },
        findOne(query) {
            const found = vendors.find((v) => {
                if (query._id && String(v._id) !== String(query._id)) return false;
                if (query.societyId && String(v.societyId) !== String(query.societyId)) return false;
                return true;
            });
            return {
                lean: async () => (found ? { ...found } : null),
                then: (resolve) => resolve(found ? { ...found } : null),
            };
        },
    };

    const mockBillingConfigModel = {
        findOne(query) {
            return {
                lean: async () => ({
                    societyId: query.societyId,
                    accountantApprovalThreshold: 5000,
                }),
            };
        },
    };

    const mockVendorPaymentModel = {
        async countDocuments(query) {
            return mockPayments.filter((p) => String(p.societyId) === String(query.societyId)).length;
        },
        async create(doc) {
            const newDoc = {
                _id: new mongoose.Types.ObjectId(),
                ...doc,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            mockPayments.push(newDoc);
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
            Vendor: mockVendorModel,
            BillingConfiguration: mockBillingConfigModel,
            VendorPayment: mockVendorPaymentModel,
            BillingAuditLog: mockAuditLogModel,
        },
        model(name) {
            return this.models[name];
        },
    };

    const accountantReq = {
        user: {
            id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000010"),
            societyId: mockSocietyAId,
            role: "accountant",
            roleKeys: ["accountant"],
        },
        opsDb: mockOpsDb,
    };

    const adminReq = {
        user: {
            id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000020"),
            societyId: mockSocietyAId,
            role: "admin",
            roleKeys: ["admin"],
        },
        opsDb: mockOpsDb,
    };

    const residentReq = {
        user: {
            id: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000030"),
            societyId: mockSocietyAId,
            role: "resident",
            roleKeys: ["resident"],
        },
        opsDb: mockOpsDb,
    };

    // ── Test a: Valid payment creation ──────────────────────────────────────────
    console.log("Testing a. Valid payment creation...");
    const validPayment = await BillingService.createVendorPayment(accountantReq, {
        vendorId: vendors[0]._id,
        amount: 3500,
        billReference: "INV-2026-001",
        paymentMode: "bank_transfer",
        description: "Plumbing maintenance for Block A",
    });

    assert.ok(validPayment, "Payment should be created");
    assert.ok(validPayment._id, "Payment should have an _id");
    assert.match(validPayment.paymentNumber, /^VP-\d{4}-\d{5}$/, "Payment number format should be VP-YYYY-XXXXX");
    assert.strictEqual(String(validPayment.societyId), String(mockSocietyAId), "societyId should match req.user");
    assert.strictEqual(String(validPayment.vendorId), String(vendors[0]._id), "vendorId should match");
    assert.strictEqual(validPayment.vendorName, "Apex Plumbing Services", "vendorName should be resolved from Vendor model");
    assert.strictEqual(validPayment.amount, 3500, "Amount should match");
    assert.strictEqual(validPayment.paymentMode, "bank_transfer", "Payment mode should match");
    assert.strictEqual(validPayment.status, "approved", "Below-threshold amount (3500 <= 5000) should be approved");
    assert.strictEqual(validPayment.approvalRequired, false, "approvalRequired should be false");
    assert.strictEqual(String(validPayment.requestedBy), String(accountantReq.user.id), "requestedBy should be user ID");
    assert.strictEqual(String(validPayment.createdBy), String(accountantReq.user.id), "createdBy should be user ID");
    console.log("✅ a. Valid payment creation passed.");

    // ── Test b: Vendor from another society rejected ────────────────────────────
    console.log("Testing b. Vendor from another society rejected...");
    try {
        await BillingService.createVendorPayment(accountantReq, {
            vendorId: vendors[1]._id, // Vendor from Society B
            amount: 2000,
            billReference: "INV-CROSS-SOC",
        });
        assert.fail("Should have rejected cross-society vendor");
    } catch (err) {
        assert.strictEqual(err.statusCode, 403, "Cross-society vendor should return 403");
        assert.strictEqual(err.message, "Vendor does not belong to your society.");
        console.log("✅ b. Vendor from another society rejected (403) passed.");
    }

    // ── Test c: Invalid vendor rejected ─────────────────────────────────────────
    console.log("Testing c. Invalid vendor rejected...");
    // c1. Missing vendorId
    try {
        await BillingService.createVendorPayment(accountantReq, {
            amount: 2000,
        });
        assert.fail("Should have failed for missing vendorId");
    } catch (err) {
        assert.strictEqual(err.statusCode, 400, "Missing vendorId should return 400");
    }

    // c2. Malformed vendorId
    try {
        await BillingService.createVendorPayment(accountantReq, {
            vendorId: "invalid-object-id-string",
            amount: 2000,
        });
        assert.fail("Should have failed for malformed vendorId");
    } catch (err) {
        assert.strictEqual(err.statusCode, 400, "Malformed vendorId should return 400");
    }

    // c3. Non-existent vendorId
    try {
        await BillingService.createVendorPayment(accountantReq, {
            vendorId: new mongoose.Types.ObjectId("60c72b2f9b1d8b2bad000099"),
            amount: 2000,
        });
        assert.fail("Should have failed for non-existent vendor");
    } catch (err) {
        assert.strictEqual(err.statusCode, 404, "Non-existent vendor should return 404");
    }
    console.log("✅ c. Invalid vendor rejection (400 / 404) passed.");

    // ── Test d: Above-threshold payment becomes pending approval ────────────────
    console.log("Testing d. Above-threshold payment becomes pending approval...");
    const aboveThresholdPayment = await BillingService.createVendorPayment(accountantReq, {
        vendorId: vendors[0]._id,
        amount: 15000, // Above threshold of 5000
        billReference: "INV-HIGH-VAL",
        paymentMode: "cheque",
    });

    assert.strictEqual(aboveThresholdPayment.status, "pending_approval", "Status must be pending_approval");
    assert.strictEqual(aboveThresholdPayment.approvalRequired, true, "approvalRequired must be true");
    assert.strictEqual(aboveThresholdPayment.approvedBy, null, "approvedBy must be null");
    assert.strictEqual(aboveThresholdPayment.approvedAt, null, "approvedAt must be null");
    console.log("✅ d. Above-threshold payment routed to pending_approval passed.");

    // ── Test e: Below/equal-threshold payment follows normal flow ───────────────
    console.log("Testing e. Below/equal-threshold payment follows normal flow...");
    // e1. Exactly equal to threshold (5000)
    const equalThresholdPayment = await BillingService.createVendorPayment(accountantReq, {
        vendorId: vendors[0]._id,
        amount: 5000,
        billReference: "INV-EXACT-5K",
    });
    assert.strictEqual(equalThresholdPayment.status, "approved", "Exact threshold (5000 <= 5000) should be approved");
    assert.strictEqual(equalThresholdPayment.approvalRequired, false, "approvalRequired must be false");
    assert.strictEqual(String(equalThresholdPayment.approvedBy), String(accountantReq.user.id), "approvedBy should be creator");

    // e2. Committee Admin creates above threshold — no approval needed
    const adminPayment = await BillingService.createVendorPayment(adminReq, {
        vendorId: vendors[0]._id,
        amount: 75000,
        billReference: "INV-ADMIN-75K",
    });
    assert.strictEqual(adminPayment.status, "approved", "Admin creates without approval required");
    assert.strictEqual(adminPayment.approvalRequired, false, "approvalRequired is false for Admin");
    console.log("✅ e. Below/equal-threshold & Committee Admin normal flow passed.");

    // ── Test f: Unauthorized user rejected ──────────────────────────────────────
    console.log("Testing f. Unauthorized user rejected...");
    const residentHasPerm = await hasBillingPermissionAsync(
        residentReq.user,
        BILLING_PERMISSIONS.VENDOR_PAYMENT_CREATE
    );
    assert.strictEqual(residentHasPerm, false, "Resident must not have VENDOR_PAYMENT_CREATE permission");

    // Test middleware behavior
    const middleware = requireBillingPermission(BILLING_PERMISSIONS.VENDOR_PAYMENT_CREATE);
    let middlewareErr = null;
    await middleware(residentReq, {}, (err) => {
        middlewareErr = err;
    });
    assert.ok(middlewareErr, "Middleware should yield an error for resident");
    assert.strictEqual(middlewareErr.statusCode, 403, "Middleware should reject resident with 403");
    console.log("✅ f. Unauthorized user rejected by billing authorization passed.");

    // ── Test g: Invalid amount rejected ─────────────────────────────────────────
    console.log("Testing g. Invalid amount rejected...");
    const invalidAmounts = [0, -100, "abc", null, undefined, ""];
    for (const badAmount of invalidAmounts) {
        try {
            await BillingService.createVendorPayment(accountantReq, {
                vendorId: vendors[0]._id,
                amount: badAmount,
            });
            assert.fail(`Should have failed for invalid amount: ${badAmount}`);
        } catch (err) {
            assert.strictEqual(err.statusCode, 400, `Amount ${badAmount} should throw 400`);
        }
    }
    console.log("✅ g. Invalid amount rejection (400) passed.");

    // ── Test h: Untrusted request body fields are ignored ───────────────────────
    console.log("Testing h. Untrusted request body fields ignored...");
    const injectionPayment = await BillingService.createVendorPayment(accountantReq, {
        vendorId: vendors[0]._id,
        amount: 12000,
        // Malicious injection attempt
        societyId: "60c72b2f9b1d8b2bad999999",
        status: "PAID",
        approvalRequired: false,
        approvedBy: "60c72b2f9b1d8b2bad888888",
        requestedBy: "60c72b2f9b1d8b2bad777777",
        createdBy: "60c72b2f9b1d8b2bad666666",
    });

    assert.strictEqual(String(injectionPayment.societyId), String(mockSocietyAId), "societyId must not be spoofed");
    assert.strictEqual(injectionPayment.status, "pending_approval", "status must not be spoofed to PAID");
    assert.strictEqual(injectionPayment.approvalRequired, true, "approvalRequired must not be spoofed");
    assert.strictEqual(injectionPayment.approvedBy, null, "approvedBy must not be spoofed");
    assert.strictEqual(String(injectionPayment.requestedBy), String(accountantReq.user.id), "requestedBy must not be spoofed");
    assert.strictEqual(String(injectionPayment.createdBy), String(accountantReq.user.id), "createdBy must not be spoofed");
    console.log("✅ h. Untrusted request body fields ignored passed.");

    console.log("\n🎉 ALL PHASE 4 VENDOR PAYMENT CREATE TESTS PASSED SUCCESSFULLY!\n");
}

if (require.main === module) {
    runVendorPaymentCreateTests().catch((err) => {
        console.error("❌ TEST FAILED:", err);
        process.exit(1);
    });
}

module.exports = { runVendorPaymentCreateTests };
