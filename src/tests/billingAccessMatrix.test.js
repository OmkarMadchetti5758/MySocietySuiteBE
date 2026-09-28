"use strict";

const assert = require("assert");
const { hasBillingPermission, canAccessBillingResource, requiresCommitteeApproval, checkSelfApproval } = require("../services/billingAuthorization.service");
const { BILLING_PERMISSIONS } = require("../common/billingPermissions");
const { ROLES } = require("../common/constants");

/**
 * Automated Access Matrix & Security Unit Tests
 *
 * These tests validate the sync (hardcoded matrix) authorization layer.
 * The async DB-based layer (hasBillingPermissionAsync) falls back to these
 * same matrix rules when no DB override exists, so passing these tests
 * guarantees correct default behavior.
 */
async function runBillingMatrixTests() {
    console.log("=========================================");
    console.log("Running Billing Access Matrix Tests...");
    console.log("=========================================");

    const committeeAdmin = { id: "user_admin_1", role: ROLES.ADMIN, roleKeys: ["admin"], societyId: "soc_A" };
    const accountant     = { id: "user_acct_1",  role: ROLES.ACCOUNTANT, roleKeys: ["accountant"], societyId: "soc_A" };
    const residentA      = { id: "user_res_A",   role: ROLES.RESIDENT_OWNER, roleKeys: ["resident_owner"], societyId: "soc_A", flatId: "flat_101" };
    const residentB      = { id: "user_res_B",   role: ROLES.RESIDENT_OWNER, roleKeys: ["resident_owner"], societyId: "soc_A", flatId: "flat_102" };
    const superAdmin     = { id: "user_super_1", role: ROLES.SUPER_ADMIN, roleKeys: ["super_admin"], societyId: null };

    // 1. Committee Admin Tests
    assert.strictEqual(hasBillingPermission(committeeAdmin, BILLING_PERMISSIONS.CHARGE_HEAD_APPROVE), true, "Committee Admin should be able to approve charge heads");
    assert.strictEqual(hasBillingPermission(committeeAdmin, BILLING_PERMISSIONS.CREDIT_NOTE_APPROVE), true, "Committee Admin should be able to approve credit notes");
    assert.strictEqual(hasBillingPermission(committeeAdmin, BILLING_PERMISSIONS.REPORT_VIEW), true, "Committee Admin should be able to view financial reports");

    // 2. Accountant Tests
    assert.strictEqual(hasBillingPermission(accountant, BILLING_PERMISSIONS.CHARGE_HEAD_CREATE), true, "Accountant should be able to create charge heads");
    assert.strictEqual(hasBillingPermission(accountant, BILLING_PERMISSIONS.CHARGE_HEAD_APPROVE), false, "Accountant MUST NOT be able to approve charge heads");
    assert.strictEqual(hasBillingPermission(accountant, BILLING_PERMISSIONS.INVOICE_GENERATE), true, "Accountant should be able to generate invoices");
    assert.strictEqual(hasBillingPermission(accountant, BILLING_PERMISSIONS.CREDIT_NOTE_CREATE), true, "Accountant should be able to create credit notes");
    assert.strictEqual(hasBillingPermission(accountant, BILLING_PERMISSIONS.CREDIT_NOTE_APPROVE), false, "Accountant MUST NOT be able to approve credit notes");

    // 3. Society Member Tests
    assert.strictEqual(hasBillingPermission(residentA, BILLING_PERMISSIONS.OWN_INVOICE_VIEW), true, "Resident should be able to view own invoice");
    assert.strictEqual(hasBillingPermission(residentA, BILLING_PERMISSIONS.INVOICE_GENERATE), false, "Resident MUST NOT be able to generate invoices");
    assert.strictEqual(hasBillingPermission(residentA, BILLING_PERMISSIONS.CHARGE_HEAD_CREATE), false, "Resident MUST NOT be able to create charge heads");
    assert.strictEqual(hasBillingPermission(residentA, BILLING_PERMISSIONS.REPORT_VIEW), false, "Resident MUST NOT be able to access society-wide reports");

    // 4. Super Admin Operational Separation Test
    assert.strictEqual(hasBillingPermission(superAdmin, BILLING_PERMISSIONS.CREDIT_NOTE_CREATE), false, "Super Admin should not perform operational credit note creation");
    assert.strictEqual(hasBillingPermission(superAdmin, BILLING_PERMISSIONS.INVOICE_GENERATE), false, "Super Admin should not generate society invoices");

    // 5. IDOR & Ownership Tests
    const invoiceResA = { id: "inv_1", societyId: "soc_A", flatId: "flat_101", userId: "user_res_A" };
    assert.strictEqual(canAccessBillingResource(residentA, invoiceResA, BILLING_PERMISSIONS.OWN_INVOICE_VIEW), true, "Resident A should access own invoice");
    assert.strictEqual(canAccessBillingResource(residentB, invoiceResA, BILLING_PERMISSIONS.OWN_INVOICE_VIEW), false, "Resident B MUST NOT access Resident A's invoice (IDOR test)");

    // 6. Cross-Society Security Test
    const accountantSocB = { id: "user_acct_2", role: ROLES.ACCOUNTANT, roleKeys: ["accountant"], societyId: "soc_B" };
    assert.strictEqual(canAccessBillingResource(accountantSocB, invoiceResA, BILLING_PERMISSIONS.INVOICE_VIEW), false, "Accountant from Society B MUST NOT access Society A resource");

    // 7. Threshold Tests
    assert.strictEqual(requiresCommitteeApproval({ user: accountant, action: BILLING_PERMISSIONS.CREDIT_NOTE_CREATE, amount: 2000 }), false, "Credit note <= ₹5000 does not trigger threshold");
    assert.strictEqual(requiresCommitteeApproval({ user: accountant, action: BILLING_PERMISSIONS.CREDIT_NOTE_CREATE, amount: 10000 }), true, "Credit note > ₹5000 triggers Committee Admin approval requirement");

    // 8. Self-Approval Prevention Test
    const itemCreatedByAdmin = { id: "cn_100", createdBy: "user_admin_1" };
    assert.strictEqual(checkSelfApproval(committeeAdmin, itemCreatedByAdmin), true, "Creator cannot self-approve restricted financial transaction");

    // ── 9. Vendor Payment Permission Tests (Phase 1 additions) ──────────────

    // 9a. Committee Admin has all vendor payment permissions
    assert.strictEqual(hasBillingPermission(committeeAdmin, BILLING_PERMISSIONS.VENDOR_PAYMENT_VIEW), true, "Committee Admin should view vendor payments");
    assert.strictEqual(hasBillingPermission(committeeAdmin, BILLING_PERMISSIONS.VENDOR_PAYMENT_CREATE), true, "Committee Admin should create vendor payments");
    assert.strictEqual(hasBillingPermission(committeeAdmin, BILLING_PERMISSIONS.VENDOR_PAYMENT_APPROVE), true, "Committee Admin should approve vendor payments");
    assert.strictEqual(hasBillingPermission(committeeAdmin, BILLING_PERMISSIONS.VENDOR_PAYMENT_MARK_PAID), true, "Committee Admin should mark vendor payments as paid");

    // 9b. Accountant can view, create, mark-paid but NOT approve
    assert.strictEqual(hasBillingPermission(accountant, BILLING_PERMISSIONS.VENDOR_PAYMENT_VIEW), true, "Accountant should view vendor payments");
    assert.strictEqual(hasBillingPermission(accountant, BILLING_PERMISSIONS.VENDOR_PAYMENT_CREATE), true, "Accountant should create vendor payments");
    assert.strictEqual(hasBillingPermission(accountant, BILLING_PERMISSIONS.VENDOR_PAYMENT_APPROVE), false, "Accountant MUST NOT approve vendor payments");
    assert.strictEqual(hasBillingPermission(accountant, BILLING_PERMISSIONS.VENDOR_PAYMENT_MARK_PAID), true, "Accountant should mark vendor payments as paid");

    // 9c. Resident MUST NOT have any vendor payment permissions
    assert.strictEqual(hasBillingPermission(residentA, BILLING_PERMISSIONS.VENDOR_PAYMENT_VIEW), false, "Resident MUST NOT view vendor payments");
    assert.strictEqual(hasBillingPermission(residentA, BILLING_PERMISSIONS.VENDOR_PAYMENT_CREATE), false, "Resident MUST NOT create vendor payments");
    assert.strictEqual(hasBillingPermission(residentA, BILLING_PERMISSIONS.VENDOR_PAYMENT_APPROVE), false, "Resident MUST NOT approve vendor payments");
    assert.strictEqual(hasBillingPermission(residentA, BILLING_PERMISSIONS.VENDOR_PAYMENT_MARK_PAID), false, "Resident MUST NOT mark vendor payments as paid");

    // 9d. Super Admin MUST NOT have operational vendor payment permissions
    assert.strictEqual(hasBillingPermission(superAdmin, BILLING_PERMISSIONS.VENDOR_PAYMENT_CREATE), false, "Super Admin should not create vendor payments");
    assert.strictEqual(hasBillingPermission(superAdmin, BILLING_PERMISSIONS.VENDOR_PAYMENT_APPROVE), false, "Super Admin should not approve vendor payments");

    // 9e. Vendor Payment threshold uses same logic as Credit Note
    assert.strictEqual(requiresCommitteeApproval({ user: accountant, action: BILLING_PERMISSIONS.VENDOR_PAYMENT_CREATE, amount: 3000 }), false, "Vendor payment <= ₹5000 does not require Committee approval");
    assert.strictEqual(requiresCommitteeApproval({ user: accountant, action: BILLING_PERMISSIONS.VENDOR_PAYMENT_CREATE, amount: 8000 }), true, "Vendor payment > ₹5000 requires Committee approval");
    assert.strictEqual(requiresCommitteeApproval({ user: committeeAdmin, action: BILLING_PERMISSIONS.VENDOR_PAYMENT_CREATE, amount: 50000 }), false, "Committee Admin never needs approval for vendor payments");

    // ── 10. Phase 2: Dynamic Approval Threshold Tests ───────────────────────
    const { getAccountantApprovalThreshold, requiresCommitteeApprovalAsync } = require("../services/billingAuthorization.service");

    // 10a. Fallback to default ₹5,000 when no society or db provided
    const defaultThreshold = await getAccountantApprovalThreshold();
    assert.strictEqual(defaultThreshold, 5000, "Default threshold should be ₹5000");

    // 10b. Dynamic threshold from mock DB
    const mockDbWithCustomThreshold = {
        models: {
            BillingConfiguration: {
                findOne: () => ({
                    lean: async () => ({ accountantApprovalThreshold: 15000 })
                })
            }
        },
        model(name) { return this.models[name]; }
    };
    const customThreshold = await getAccountantApprovalThreshold({ db: mockDbWithCustomThreshold, societyId: "soc_custom" });
    assert.strictEqual(customThreshold, 15000, "Custom society threshold should be ₹15000");

    // 10c. Credit Note below custom threshold (e.g. ₹12,000 <= ₹15,000) requires NO Committee approval
    const cnBelowNeedsApproval = await requiresCommitteeApprovalAsync({
        db: mockDbWithCustomThreshold,
        societyId: "soc_custom",
        user: accountant,
        action: BILLING_PERMISSIONS.CREDIT_NOTE_CREATE,
        amount: 12000,
    });
    assert.strictEqual(cnBelowNeedsApproval, false, "Credit note of ₹12,000 with ₹15,000 threshold does not require Committee Admin approval");

    // 10d. Credit Note above custom threshold (e.g. ₹18,000 > ₹15,000) DOES require Committee approval
    const cnAboveNeedsApproval = await requiresCommitteeApprovalAsync({
        db: mockDbWithCustomThreshold,
        societyId: "soc_custom",
        user: accountant,
        action: BILLING_PERMISSIONS.CREDIT_NOTE_CREATE,
        amount: 18000,
    });
    assert.strictEqual(cnAboveNeedsApproval, true, "Credit note of ₹18,000 with ₹15,000 threshold requires Committee Admin approval");

    // 10e. Vendor Payment below custom threshold (₹12,000 <= ₹15,000) requires NO Committee approval
    const vpBelowNeedsApproval = await requiresCommitteeApprovalAsync({
        db: mockDbWithCustomThreshold,
        societyId: "soc_custom",
        user: accountant,
        action: BILLING_PERMISSIONS.VENDOR_PAYMENT_CREATE,
        amount: 12000,
    });
    assert.strictEqual(vpBelowNeedsApproval, false, "Vendor payment of ₹12,000 with ₹15,000 threshold does not require Committee Admin approval");

    // 10f. Vendor Payment above custom threshold (₹20,000 > ₹15,000) DOES require Committee approval
    const vpAboveNeedsApproval = await requiresCommitteeApprovalAsync({
        db: mockDbWithCustomThreshold,
        societyId: "soc_custom",
        user: accountant,
        action: BILLING_PERMISSIONS.VENDOR_PAYMENT_CREATE,
        amount: 20000,
    });
    assert.strictEqual(vpAboveNeedsApproval, true, "Vendor payment of ₹20,000 with ₹15,000 threshold requires Committee Admin approval");

    // 10g. Committee Admin never requires approval even above custom threshold
    const vpAdminNeedsApproval = await requiresCommitteeApprovalAsync({
        db: mockDbWithCustomThreshold,
        societyId: "soc_custom",
        user: committeeAdmin,
        action: BILLING_PERMISSIONS.VENDOR_PAYMENT_CREATE,
        amount: 50000,
    });
    assert.strictEqual(vpAdminNeedsApproval, false, "Committee Admin never requires approval even above dynamic threshold");

    console.log("✅ ALL 10 BILLING ACCESS MATRIX SECURITY TESTS PASSED SUCCESSFULLY!");
}

if (require.main === module) {
    runBillingMatrixTests().catch((err) => {
        console.error("❌ TEST FAILED:", err);
        process.exit(1);
    });
}

module.exports = runBillingMatrixTests;
