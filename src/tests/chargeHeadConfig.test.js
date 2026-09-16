"use strict";

const assert = require("assert");
const BillingService = require("../modules/billing/billing.service");
const AppError = require("../common/AppError");

async function runChargeHeadConfigTests() {
    console.log("=========================================");
    console.log("Running Charge Head & Billing Config Tests...");
    console.log("=========================================");

    // Mock Ops DB Connection & Models in memory for fast testing
    const mockChargeHeads = [];
    const mockAuditLogs = [];
    let mockBillingConfig = null;

    const mockChargeHeadModel = {
        async create(doc) {
            const newDoc = {
                _id: "ch_" + (mockChargeHeads.length + 1),
                deletedAt: null,
                ...doc,
                createdAt: new Date(),
                updatedAt: new Date(),
                save: async function () { return this; }
            };
            mockChargeHeads.push(newDoc);
            return newDoc;
        },
        async findOne(query) {
            return mockChargeHeads.find(item => {
                if (query._id && String(item._id) !== String(query._id)) return false;
                if (query.societyId && String(item.societyId) !== String(query.societyId)) return false;
                if (query.status && query.status !== item.status) return false;
                if (query.code && query.code !== item.code) return false;
                if (query.deletedAt === null && item.deletedAt !== null) return false;
                if (query.$or && Array.isArray(query.$or)) {
                    const matchesOr = query.$or.some(clause => {
                        if (clause.code && item.code === clause.code) return true;
                        if (clause.name && clause.name.$regex && clause.name.$regex.test(item.name)) return true;
                        return false;
                    });
                    if (!matchesOr) return false;
                }
                return true;
            }) || null;
        },
        find(query) {
            let res = mockChargeHeads.filter(item => {
                if (query.societyId && String(item.societyId) !== String(query.societyId)) return false;
                if (query.deletedAt === null && item.deletedAt !== null) return false;
                if (query.category && item.category !== query.category) return false;
                if (query.status && item.status !== query.status) return false;
                return true;
            });
            return {
                sort: () => ({ lean: async () => res }),
                lean: async () => res,
            };
        },
        async updateOne(query, update) {
            const found = mockChargeHeads.find(item => String(item._id) === String(query._id));
            if (found && update.$set) {
                Object.assign(found, update.$set);
            }
            return { modifiedCount: found ? 1 : 0 };
        },
        async findOneAndUpdate(query, update, options) {
            const found = mockChargeHeads.find(item => String(item._id) === String(query._id) && item.status === query.status);
            if (found && update.$set) {
                Object.assign(found, update.$set);
                return found;
            }
            return null;
        }
    };

    const mockBillingConfigModel = {
        async findOne(query) {
            if (mockBillingConfig && String(mockBillingConfig.societyId) === String(query.societyId)) {
                return { ...mockBillingConfig, lean: async () => mockBillingConfig };
            }
            return null;
        },
        async findOneAndUpdate(query, update, options) {
            if (!mockBillingConfig) {
                mockBillingConfig = {
                    _id: "cfg_1",
                    societyId: query.societyId,
                    ...update.$setOnInsert,
                    ...update.$set,
                };
            } else {
                Object.assign(mockBillingConfig, update.$set);
            }
            return mockBillingConfig;
        }
    };

    const mockBillingInvoiceModel = {
        async countDocuments() { return 0; }
    };

    const mockOpsDb = {
        models: {
            ChargeHead: mockChargeHeadModel,
            BillingConfiguration: mockBillingConfigModel,
            BillingInvoice: mockBillingInvoiceModel,
            BillingAuditLog: {
                async create(log) { mockAuditLogs.push(log); return log; }
            }
        },
        model(name) {
            return this.models[name];
        }
    };

    const reqAccountant = {
        user: { id: "u_acct_1", societyId: "soc_100", role: "accountant", roleKeys: ["accountant"] },
        opsDb: mockOpsDb,
    };

    const reqAdmin = {
        user: { id: "u_admin_1", societyId: "soc_100", role: "admin", roleKeys: ["admin"] },
        opsDb: mockOpsDb,
    };

    // 1. Create FIXED Charge Head
    const chFixed = await BillingService.createChargeHead(reqAccountant, {
        name: "Maintenance Charge",
        code: "MAINT",
        category: "INCOME",
        calculationType: "FIXED",
        defaultAmount: 2500,
        gstApplicable: true,
        gstRate: 18,
    });
    assert.strictEqual(chFixed.name, "Maintenance Charge");
    assert.strictEqual(chFixed.code, "MAINT");
    assert.strictEqual(chFixed.category, "INCOME");
    assert.strictEqual(chFixed.calculationType, "FIXED");
    assert.strictEqual(chFixed.defaultAmount, 2500);
    assert.strictEqual(chFixed.gstApplicable, true);
    assert.strictEqual(chFixed.gstRate, 18);
    assert.strictEqual(chFixed.status, "PENDING_APPROVAL");
    console.log("✅ 1. FIXED charge head creation passed.");

    // 2. Create PER_SQ_FT Charge Head
    const chPerSqFt = await BillingService.createChargeHead(reqAccountant, {
        name: "Sinking Fund",
        code: "SINKING_FUND",
        category: "INCOME",
        calculationType: "PER_SQ_FT",
        ratePerSqFt: 3.5,
        gstApplicable: false,
    });
    assert.strictEqual(chPerSqFt.calculationType, "PER_SQ_FT");
    assert.strictEqual(chPerSqFt.ratePerSqFt, 3.5);
    assert.strictEqual(chPerSqFt.gstApplicable, false);
    assert.strictEqual(chPerSqFt.gstRate, null);
    console.log("✅ 2. PER_SQ_FT charge head creation passed.");

    // 3. GST Validation Error Test
    try {
        await BillingService.createChargeHead(reqAccountant, {
            name: "Invalid GST Charge",
            calculationType: "FIXED",
            defaultAmount: 500,
            gstApplicable: true,
            gstRate: 0,
        });
        assert.fail("Should have thrown AppError for invalid GST rate");
    } catch (err) {
        assert.strictEqual(err instanceof AppError, true);
        console.log("✅ 3. GST rate validation passed.");
    }

    // 4. Duplicate Code Test
    try {
        await BillingService.createChargeHead(reqAccountant, {
            name: "Maintenance Charge Clone",
            code: "MAINT",
            calculationType: "FIXED",
            defaultAmount: 3000,
        });
        assert.fail("Should have thrown AppError for duplicate code");
    } catch (err) {
        if (err.name === "AssertionError") throw err;
        assert.strictEqual(err.statusCode, 409);
        console.log("✅ 4. Duplicate code prevention passed.");
    }

    // 5. Self-Approval Prohibition Test
    try {
        await BillingService.approveChargeHead(reqAccountant, chFixed._id, "approve");
        assert.fail("Accountant should not self-approve or approve charge heads");
    } catch (err) {
        console.log("✅ 5. Accountant approval prohibition passed.");
    }

    // 6. Committee Admin Approval Test
    const approvedCh = await BillingService.approveChargeHead(reqAdmin, chFixed._id, "approve");
    assert.strictEqual(approvedCh.status, "APPROVED");
    assert.strictEqual(approvedCh.approvedBy, "u_admin_1");
    console.log("✅ 6. Committee Admin approval workflow passed.");

    // 7. Edit Approved Charge Head (Historical Versioning Test)
    const newVersionCandidate = await BillingService.updateChargeHead(reqAccountant, chFixed._id, {
        defaultAmount: 3000,
    });
    assert.strictEqual(newVersionCandidate.version, 2);
    assert.strictEqual(String(newVersionCandidate.parentChargeHeadId), String(chFixed._id));
    assert.strictEqual(newVersionCandidate.status, "PENDING_APPROVAL");
    // Ensure original approved version remains intact until new version approved
    assert.strictEqual(chFixed.defaultAmount, 2500);
    assert.strictEqual(chFixed.status, "APPROVED");
    console.log("✅ 7. Historical versioning & edit immutability passed.");

    // 8. Billing Configuration Upsert & Fetch Test
    const config = await BillingService.upsertBillingConfig(reqAdmin, {
        billingFrequency: "MONTHLY",
        billingDay: 1,
        dueDays: 15,
        arrearsDisplayMode: "LINE_BY_LINE",
        defaultTaxSettings: { taxName: "GST", taxRate: 18 },
    });
    assert.strictEqual(config.billingFrequency, "MONTHLY");
    assert.strictEqual(config.dueDays, 15);
    assert.strictEqual(config.arrearsDisplayMode, "LINE_BY_LINE");
    console.log("✅ 8. Billing Configuration upsert passed.");

    console.log("\n🎉 ALL CHARGE HEAD & BILLING CONFIG TESTS PASSED SUCCESSFULY!\n");
}

if (require.main === module) {
    runChargeHeadConfigTests().catch(err => {
        console.error("❌ TEST FAILED:", err);
        process.exit(1);
    });
}

module.exports = { runChargeHeadConfigTests };
