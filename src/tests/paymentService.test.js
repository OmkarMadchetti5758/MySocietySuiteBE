"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const PaymentService = require("../modules/payment/payment.service");

async function runPaymentServiceTests() {
    console.log("=========================================");
    console.log("Running Payment Service Unit Tests...");
    console.log("=========================================");

    const mockSocietyId = new mongoose.Types.ObjectId();
    const mockFlatId = new mongoose.Types.ObjectId();
    const mockUserId = new mongoose.Types.ObjectId();
    const mockInvoiceId = new mongoose.Types.ObjectId();

    // In-memory data stores
    const mockPayments = [];
    const mockInvoices = [
        {
            _id: mockInvoiceId,
            societyId: mockSocietyId,
            flatId: mockFlatId,
            invoiceNumber: "INV-2026-00001",
            totalAmount: 5000,
            amountPaid: 0,
            paidAmount: 0,
            balanceDue: 5000,
            status: "ISSUED",
            items: [{ description: "Maintenance", totalAmount: 5000 }],
            save: async function () { return this; },
        }
    ];
    const mockReceipts = [];
    const mockFlats = [
        {
            _id: mockFlatId,
            societyId: mockSocietyId,
            wing: "A",
            flatNumber: "101",
            advanceBalance: 0,
            save: async function () { return this; },
        }
    ];
    const mockUsers = [
        {
            _id: mockUserId,
            name: "John Doe",
            email: "john@example.com",
            phone: "9876543210",
        }
    ];

    // Models dictionary
    const mockModels = {
        Payment: {
            async create(doc) {
                const newDoc = {
                    _id: new mongoose.Types.ObjectId(),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    ...doc,
                    save: async function () { return this; }
                };
                mockPayments.push(newDoc);
                return newDoc;
            },
            async findOne(query) {
                return mockPayments.find(p => {
                    if (query._id && String(p._id) !== String(query._id)) return false;
                    if (query.paymentNumber && p.paymentNumber !== query.paymentNumber) return false;
                    if (query.gatewayOrderId && p.gatewayOrderId !== query.gatewayOrderId) return false;
                    if (query.societyId && String(p.societyId) !== String(query.societyId)) return false;
                    return true;
                }) || null;
            },
            async countDocuments(query) {
                return mockPayments.filter(p => {
                    if (query.societyId && String(p.societyId) !== String(query.societyId)) return false;
                    if (query.paymentStatus && p.paymentStatus !== query.paymentStatus) return false;
                    return true;
                }).length;
            },
            find(query) {
                let results = mockPayments.filter(p => {
                    if (query.societyId && String(p.societyId) !== String(query.societyId)) return false;
                    if (query.paymentStatus) {
                        if (typeof query.paymentStatus === 'object' && query.paymentStatus.$in) {
                            if (!query.paymentStatus.$in.includes(p.paymentStatus)) return false;
                        } else if (p.paymentStatus !== query.paymentStatus) return false;
                    }
                    return true;
                });
                const createChain = (res) => ({
                    sort: () => createChain(res),
                    skip: () => createChain(res),
                    limit: () => createChain(res),
                    populate: () => createChain(res),
                    lean: async () => res,
                    exec: async () => res
                });
                return createChain(results);
            },
            async aggregate(pipeline) {
                const matchStage = pipeline.find(stage => stage.$match)?.$match || {};
                const filtered = mockPayments.filter(p => {
                    if (matchStage.societyId && String(p.societyId) !== String(matchStage.societyId)) return false;
                    if (matchStage.paymentStatus && p.paymentStatus !== matchStage.paymentStatus) return false;
                    if (matchStage.paymentSource && p.paymentSource !== matchStage.paymentSource) return false;
                    if (matchStage.paymentDate) {
                        if (matchStage.paymentDate.$gte && p.paymentDate < matchStage.paymentDate.$gte) return false;
                        if (matchStage.paymentDate.$lte && p.paymentDate > matchStage.paymentDate.$lte) return false;
                    }
                    return true;
                });

                const groupStage = pipeline.find(stage => stage.$group)?.$group;
                if (!groupStage) return [];

                const groupField = groupStage._id ? String(groupStage._id).replace("$", "") : null;
                const groups = {};

                for (const item of filtered) {
                    const key = groupField ? item[groupField] : null;
                    if (!groups[key]) groups[key] = { _id: key, total: 0, count: 0 };
                    groups[key].total += item.amount || 0;
                    groups[key].count += 1;
                }
                return Object.values(groups);
            }
        },
        BillingInvoice: {
            async findOne(query) {
                return mockInvoices.find(i => String(i._id) === String(query._id)) || null;
            },
            find(query) {
                let res = mockInvoices.filter(i => {
                    if (query.societyId && String(i.societyId) !== String(query.societyId)) return false;
                    if (query.status && typeof query.status === 'object' && query.status.$nin) {
                        if (query.status.$nin.includes(i.status)) return false;
                    }
                    return true;
                });
                return { lean: async () => res };
            },
            async aggregate(pipeline) {
                const totalUncollected = mockInvoices.reduce((acc, inv) => acc + (inv.totalAmount - (inv.paidAmount || 0)), 0);
                return [{ _id: null, total: totalUncollected }];
            }
        },
        Receipt: {
            async create(doc) {
                const rec = {
                    _id: new mongoose.Types.ObjectId(),
                    ...doc,
                    createdAt: new Date(),
                };
                mockReceipts.push(rec);
                return rec;
            },
            async countDocuments() {
                return mockReceipts.length;
            }
        },
        Flat: {
            async findOne(query) {
                return mockFlats.find(f => String(f._id) === String(query._id)) || null;
            },
            async findById(id) {
                return mockFlats.find(f => String(f._id) === String(id)) || null;
            }
        },
        User: {
            async findOne(query) {
                return mockUsers.find(u => String(u._id) === String(query._id)) || null;
            },
            async findById(id) {
                return mockUsers.find(u => String(u._id) === String(id)) || null;
            }
        },
        AdvanceAccount: {
            async findOne(query) {
                return null;
            },
            async create(doc) {
                return { _id: new mongoose.Types.ObjectId(), ...doc, save: async function() { return this; } };
            }
        },
        InvoicePayment: {
            async create(doc) {
                return { _id: new mongoose.Types.ObjectId(), ...doc, save: async function() { return this; } };
            }
        },
        BillingAuditLog: {
            async create(doc) {
                return { _id: new mongoose.Types.ObjectId(), ...doc };
            }
        }
    };

    // Helper: Mock DB object for opsDb
    const mockDb = {
        models: mockModels,
        model: function (name) {
            return this.models[name];
        }
    };

    // ── Test 1: Record Offline Payment ──
    console.log("Test 1: Record Offline Cash Payment...");
    const offlineResult = await PaymentService.recordOfflinePayment({
        req: { ip: "127.0.0.1", headers: {} },
        db: mockDb,
        societyId: mockSocietyId,
        recordedBy: mockUserId,
        flatId: mockFlatId,
        userId: mockUserId,
        invoiceId: mockInvoiceId,
        amount: 5000,
        paymentMode: "CASH",
        referenceNumber: "CASH-REF-001",
        paymentAccountId: "MAIN_CASH_ACC",
        paymentAccountName: "Cash in Hand Account",
        notes: "Paid in cash at office",
    });

    assert.ok(offlineResult.payment, "Payment object should be created");
    assert.strictEqual(offlineResult.payment.paymentStatus, "SUCCESS", "Offline payment status should be SUCCESS");
    assert.strictEqual(offlineResult.payment.reconciliationStatus, "RECONCILED", "Offline payment should be RECONCILED");
    assert.strictEqual(mockInvoices[0].status, "PAID", "Invoice status should be updated to PAID");
    assert.strictEqual(mockInvoices[0].totalAmount - mockInvoices[0].paidAmount, 0, "Invoice remaining balance should be 0");
    assert.ok(offlineResult.receipt, "Receipt should be generated");
    console.log("✅ Test 1 Passed: Record Offline Cash Payment");

    // ── Test 2: Get Overview Stats ──
    console.log("\nTest 2: Get Overview Stats...");
    const stats = await PaymentService.getOverviewStats({
        db: mockDb,
        societyId: mockSocietyId.toString(),
    });

    assert.strictEqual(stats.totalCollected, 5000, "Total collection should equal 5000");
    assert.strictEqual(stats.offlineCollection, 5000, "Offline collection should equal 5000");
    assert.strictEqual(stats.onlineCollection, 0, "Online collection should be 0");
    console.log("✅ Test 2 Passed: Get Overview Stats");

    // ── Test 3: Get Collections Analytics (Testing ObjectId Cast & Aggregation) ──
    console.log("\nTest 3: Get Collections Analytics...");
    const todayStr = new Date().toISOString().split("T")[0];
    const analytics = await PaymentService.getCollectionsAnalytics({
        db: mockDb,
        societyId: mockSocietyId.toString(), // Passed as string to verify ObjectId cast
        startDate: "2026-01-01",
        endDate: todayStr,
    });

    assert.ok(Array.isArray(analytics.byMode), "byMode should be an array");
    assert.strictEqual(analytics.byMode.length, 1, "Should have 1 mode group (CASH)");
    assert.strictEqual(analytics.byMode[0]._id, "CASH", "Mode should be CASH");
    assert.strictEqual(analytics.byMode[0].total, 5000, "CASH collection total should be 5000");

    assert.ok(Array.isArray(analytics.bySource), "bySource should be an array");
    assert.strictEqual(analytics.bySource[0]._id, "OFFLINE", "Source should be OFFLINE");
    console.log("✅ Test 3 Passed: Get Collections Analytics (ObjectId fix verified)");

    // ── Test 4: Payments List & Filtering ──
    console.log("\nTest 4: Get Payments List...");
    const listResult = await PaymentService.getPaymentsList({
        db: mockDb,
        societyId: mockSocietyId.toString(),
        page: 1,
        limit: 10,
    });

    assert.strictEqual(listResult.data.length, 1, "Should return 1 payment in list");
    assert.strictEqual(listResult.pagination.total, 1, "Total count should be 1");
    console.log("✅ Test 4 Passed: Get Payments List");

    // ── Test 5: Manual Reconciliation ──
    console.log("\nTest 5: Manual Reconcile Payment...");
    // Create an unreconciled payment doc
    const unrecPayment = await mockDb.models.Payment.create({
        societyId: mockSocietyId,
        flatId: mockFlatId,
        userId: mockUserId,
        paymentNumber: "PAY-2026-00099",
        amount: 2000,
        paymentMode: "BANK_TRANSFER",
        paymentSource: "OFFLINE",
        paymentStatus: "SUCCESS",
        reconciliationStatus: "UNRECONCILED",
        paymentAccountId: "HDFC_BANK_ACC",
        paymentDate: new Date(),
    });

    const mockInvoice2 = {
        _id: new mongoose.Types.ObjectId(),
        societyId: mockSocietyId,
        flatId: mockFlatId,
        invoiceNumber: "INV-2026-00002",
        totalAmount: 2000,
        amountPaid: 0,
        balanceDue: 2000,
        status: "ISSUED",
        items: [{ description: "Maintenance", totalAmount: 2000 }],
        save: async function () { return this; },
    };
    mockInvoices.push(mockInvoice2);

    const reconcileResult = await PaymentService.manualReconcilePayment({
        req: { ip: "127.0.0.1", headers: {} },
        db: mockDb,
        societyId: mockSocietyId,
        paymentId: unrecPayment._id,
        invoiceId: mockInvoice2._id,
        userId: mockUserId,
    });

    assert.strictEqual(reconcileResult.payment.reconciliationStatus, "RECONCILED", "Payment status should update to RECONCILED");
    assert.strictEqual(mockInvoice2.status, "PAID", "Invoice status should update to PAID");
    assert.ok(reconcileResult.receipt, "Receipt should be created upon reconciliation");
    console.log("✅ Test 5 Passed: Manual Reconcile Payment");

    // ── Test 6: Get Pending / Failed Payments ──
    console.log("\nTest 6: Get Pending / Failed Payments...");
    await mockDb.models.Payment.create({
        societyId: mockSocietyId,
        flatId: mockFlatId,
        userId: mockUserId,
        paymentNumber: "PAY-2026-00100",
        amount: 1500,
        paymentMode: "UPI",
        paymentSource: "ONLINE",
        paymentStatus: "PENDING",
        reconciliationStatus: "UNRECONCILED",
        paymentAccountId: "ONLINE_ACC",
        paymentDate: new Date(),
    });

    const pendingResult = await PaymentService.getPendingFailedPayments({
        db: mockDb,
        societyId: mockSocietyId.toString(),
        page: 1,
        limit: 10,
    });

    const pendingItem = pendingResult.data.find(p => p.paymentNumber === "PAY-2026-00100");
    assert.ok(pendingItem, "Pending payment should exist in list");
    assert.strictEqual(pendingItem.paymentStatus, "PENDING", "Payment status should be PENDING");
    console.log("✅ Test 6 Passed: Get Pending / Failed Payments");

    console.log("\n🎉 ALL 6 PAYMENT SERVICE UNIT TESTS PASSED SUCCESSFULLY!\n");
}

if (require.main === module) {
    runPaymentServiceTests().catch((err) => {
        console.error("❌ TEST FAILED:", err);
        process.exit(1);
    });
}

module.exports = { runPaymentServiceTests };
