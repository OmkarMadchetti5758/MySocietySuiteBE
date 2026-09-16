"use strict";

const assert = require("assert");
const { hasBillingPermission, canAccessBillingResource, requiresCommitteeApproval, checkSelfApproval } = require("../services/billingAuthorization.service");
const { BILLING_PERMISSIONS } = require("../common/billingPermissions");
const { ROLES } = require("../common/constants");

/**
 * Automated Access Matrix & Security Unit Tests
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

    console.log("✅ ALL 8 BILLING ACCESS MATRIX SECURITY TESTS PASSED SUCCESSFULLY!");
}

if (require.main === module) {
    runBillingMatrixTests().catch((err) => {
        console.error("❌ TEST FAILED:", err);
        process.exit(1);
    });
}

module.exports = runBillingMatrixTests;
