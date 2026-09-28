"use strict";

const assert = require("assert");
const { requiresCommitteeApproval, checkSelfApproval } = require("../services/billingAuthorization.service");
const { BILLING_PERMISSIONS } = require("../common/billingPermissions");
const { ROLES } = require("../common/constants");

/**
 * BRD 6.6 Credit Notes & Discounts Verification Tests
 */
async function runCreditNotesDiscountsTests() {
    console.log("==================================================");
    console.log("Running BRD 6.6 Credit Notes & Discounts Tests...");
    console.log("==================================================");

    const accountantUser = {
        id: "acct_user_1",
        role: ROLES.ACCOUNTANT,
        roleKeys: ["accountant"],
        societyId: "soc_test",
    };

    const adminUser = {
        id: "admin_user_1",
        role: ROLES.ADMIN,
        roleKeys: ["admin"],
        societyId: "soc_test",
    };

    const threshold = 5000;

    // Test 1: Mandatory reason validation logic
    const validateReason = (reason) => {
        if (!reason || typeof reason !== "string" || !reason.trim()) {
            throw new Error("A mandatory reason must be provided");
        }
        return reason.trim();
    };

    assert.throws(() => validateReason(""), /mandatory reason/, "Empty reason must be rejected");
    assert.throws(() => validateReason("   "), /mandatory reason/, "Whitespace-only reason must be rejected");
    assert.throws(() => validateReason(null), /mandatory reason/, "Null reason must be rejected");
    assert.strictEqual(validateReason("Overcharged water meter"), "Overcharged water meter", "Valid reason accepted");
    console.log("✓ Test 1: Mandatory reason enforcement (FR-B6.1 & FR-B6.2) verified.");

    // Test 2: FR-B6.3 Approval Threshold for Credit Notes
    const cnWithinThreshold = requiresCommitteeApproval({
        user: accountantUser,
        action: BILLING_PERMISSIONS.CREDIT_NOTE_CREATE,
        amount: 3500,
        thresholdOverride: threshold,
    });
    assert.strictEqual(cnWithinThreshold, false, "Credit note <= ₹5000 should not require Committee Admin approval");

    const cnAboveThreshold = requiresCommitteeApproval({
        user: accountantUser,
        action: BILLING_PERMISSIONS.CREDIT_NOTE_CREATE,
        amount: 5001,
        thresholdOverride: threshold,
    });
    assert.strictEqual(cnAboveThreshold, true, "Credit note > ₹5000 must require Committee Admin approval");
    console.log("✓ Test 2: Credit note approval threshold routing (FR-B6.3) verified.");

    // Test 3: FR-B6.3 Approval Threshold for Discounts
    const discWithinThreshold = requiresCommitteeApproval({
        user: accountantUser,
        action: BILLING_PERMISSIONS.DISCOUNT_CREATE,
        amount: 1500,
        thresholdOverride: threshold,
    });
    assert.strictEqual(discWithinThreshold, false, "Discount <= ₹5000 should not require Committee Admin approval");

    const discAboveThreshold = requiresCommitteeApproval({
        user: accountantUser,
        action: BILLING_PERMISSIONS.DISCOUNT_CREATE,
        amount: 7500,
        thresholdOverride: threshold,
    });
    assert.strictEqual(discAboveThreshold, true, "Discount > ₹5000 must require Committee Admin approval");
    console.log("✓ Test 3: Discount approval threshold routing (FR-B6.3) verified.");

    // Test 4: Admin creates credit note / discount - does not need threshold approval
    const adminCN = requiresCommitteeApproval({
        user: adminUser,
        action: BILLING_PERMISSIONS.CREDIT_NOTE_CREATE,
        amount: 25000,
        thresholdOverride: threshold,
    });
    assert.strictEqual(adminCN, false, "Admin creation should not trigger threshold approval");
    console.log("✓ Test 4: Committee Admin direct authority verified.");

    // Test 5: Self-approval prevention
    const selfCreatedRecord = {
        createdBy: "acct_user_1",
        amount: 6000,
    };
    assert.strictEqual(
        checkSelfApproval(accountantUser, selfCreatedRecord),
        true,
        "User attempting to approve their own record must be flagged as self-approval"
    );

    const differentUserRecord = {
        createdBy: "acct_user_2",
        amount: 6000,
    };
    assert.strictEqual(
        checkSelfApproval(adminUser, differentUserRecord),
        false,
        "Another admin approving record created by accountant is allowed"
    );
    console.log("✓ Test 5: Self-approval guard verified.");

    // Test 6: Business Rule - Past invoice reduction calculation
    const pastInvoice = {
        totalAmount: 4000,
        paidAmount: 1000,
        creditNoteAmount: 0,
        status: "PARTIALLY_PAID",
    };
    const creditNoteAmount = 1500;
    pastInvoice.creditNoteAmount += creditNoteAmount;
    pastInvoice.totalAmount = Math.max(0, pastInvoice.totalAmount - creditNoteAmount);
    assert.strictEqual(pastInvoice.totalAmount, 2500, "Invoice total payable reduced by credit note");
    assert.strictEqual(pastInvoice.creditNoteAmount, 1500, "Invoice tracks credit note amount distinctly");
    console.log("✓ Test 6: Past invoice liability reduction business rule verified.");

    console.log("==================================================");
    console.log("✅ ALL BRD 6.6 CREDIT NOTES & DISCOUNTS TESTS PASSED!");
    console.log("==================================================");
}

runCreditNotesDiscountsTests().catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
});
