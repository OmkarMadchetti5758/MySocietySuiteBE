"use strict";

const AppError = require("../../common/AppError");
const { getLedgerModels } = require("./ledger.model");
const { LedgerService } = require("./ledger.service");

function isStrictObjectId(value) {
    return /^[a-fA-F0-9]{24}$/.test(String(value || ""));
}

function asObjectIdOrNull(value) {
    return isStrictObjectId(value) ? value : null;
}

class LedgerPostingService {

    /** Ledger failures must not roll back the source money event. */
    static async autoPost(label, fn) {
        try {
            return await fn();
        } catch (err) {
            console.error(`[LEDGER AUTO-POST] ${label}:`, err.message);
            if (err.stack) console.error(err.stack);
            return null;
        }
    }

    static async ensureBooksReady(societyId, userId, db) {
        const seedUser = asObjectIdOrNull(userId) || societyId;
        await LedgerService.ensureSystemChartOfAccounts(societyId, seedUser, db);
        try {
            await LedgerService.syncFinancialAccounts(societyId, db);
        } catch (err) {
            console.error("[LEDGER AUTO-POST] syncFinancialAccounts:", err.message);
        }
    }

    static async getSystemAccount(societyId, accountCode, db) {
        const { ChartOfAccount } = getLedgerModels(db);
        let account = await ChartOfAccount.findOne({ societyId, accountCode }).lean();
        if (!account) {
            await this.ensureBooksReady(societyId, null, db);
            account = await ChartOfAccount.findOne({ societyId, accountCode }).lean();
        }
        if (!account) {
            throw new AppError(`System account with code ${accountCode} is missing for this society.`, 500);
        }
        return account._id;
    }

    /** Map a bank/cash financial account (or string code like PRIMARY_CASH_ACC) to a GL account. */
    static async resolveBankOrCashGl(societyId, financialAccountId, db, { preferCash = false } = {}) {
        await this.ensureBooksReady(societyId, null, db);
        const { ChartOfAccount } = getLedgerModels(db);
        const raw = financialAccountId ? String(financialAccountId) : "";

        if (isStrictObjectId(raw)) {
            const linked = await ChartOfAccount.findOne({ societyId, financialAccountId: raw, status: "ACTIVE" }).lean();
            if (linked) return linked._id;
            const asCoa = await ChartOfAccount.findOne({ societyId, _id: raw, status: "ACTIVE" }).lean();
            if (asCoa) return asCoa._id;
        }

        const looksLikeRealAccount = isStrictObjectId(raw);
        const looksCash = !looksLikeRealAccount && (preferCash || /CASH|PETTY/i.test(raw));
        return this.getSystemAccount(societyId, looksCash ? "1011" : "1010", db);
    }

    // 1. Invoice finalized
    static async postInvoiceFinalized({ societyId, userId, invoice, db, session }) {
        const receivableAcc = await this.getSystemAccount(societyId, "1021", db);
        const gstPayableAcc = await this.getSystemAccount(societyId, "2050", db);
        const defaultIncomeAcc = await this.getSystemAccount(societyId, "4010", db);

        let lines = [];
        let totalReceivable = 0;

        for (const item of (invoice.lineItems || [])) {
            const title = item.chargeHeadTitle || item.chargeHeadName || "";
            if (item.isArrears || title === "Arrears") continue;

            const lineAmount = Number(item.baseAmount ?? item.amount ?? 0);
            const gstAmount = Number(item.gstAmount || 0);
            const mappedIncome = item.ledgerAccountId && isStrictObjectId(item.ledgerAccountId)
                ? item.ledgerAccountId
                : defaultIncomeAcc;

            if (lineAmount > 0) {
                lines.push({ accountId: mappedIncome, credit: lineAmount, description: `Income: ${title || "Invoice"}`, residentId: invoice.userId, flatId: invoice.flatId });
                totalReceivable += lineAmount;
            }
            if (gstAmount > 0) {
                lines.push({ accountId: gstPayableAcc, credit: gstAmount, description: `GST: ${title || "Invoice"}`, residentId: invoice.userId, flatId: invoice.flatId });
                totalReceivable += gstAmount;
            }
        }

        const fineAmount = Number(invoice.fineAmount || 0);
        if (fineAmount > 0) {
            const fineIncomeAcc = await this.getSystemAccount(societyId, "4040", db);
            lines.push({ accountId: fineIncomeAcc, credit: fineAmount, description: `Late fee: ${invoice.invoiceNumber}`, residentId: invoice.userId, flatId: invoice.flatId });
            totalReceivable += fineAmount;
        }

        if (totalReceivable === 0) return null;

        lines.push({ accountId: receivableAcc, debit: totalReceivable, description: `Invoice ${invoice.invoiceNumber}`, residentId: invoice.userId, flatId: invoice.flatId });

        return LedgerService.postJournalEntry({
            societyId, userId, userRole: "system", description: `Invoice Finalized: ${invoice.invoiceNumber}`,
            transactionDate: invoice.createdAt || new Date(), referenceType: "INVOICE", referenceId: invoice._id, referenceNumber: invoice.invoiceNumber,
            lines, idempotencyKey: `INV-${invoice._id}`, isAutomatic: true, residentId: invoice.userId, flatId: invoice.flatId, db, session
        });
    }

    // 2. Payment received (online or offline)
    static async postPaymentReceived({ societyId, userId, payment, financialAccountId, db, session }) {
        const receivableAcc = await this.getSystemAccount(societyId, "1021", db);
        const bankAccId = await this.resolveBankOrCashGl(
            societyId,
            financialAccountId || payment.financialAccountId || payment.paymentAccountId,
            db,
            { preferCash: !isStrictObjectId(financialAccountId || payment.financialAccountId || payment.paymentAccountId)
                && String(payment.paymentMode || "").toUpperCase() === "CASH" }
        );

        const lines = [
            { accountId: bankAccId, debit: payment.amount, description: `Payment Received ${payment.receiptNumber || ''}`, residentId: payment.userId, flatId: payment.flatId },
            { accountId: receivableAcc, credit: payment.amount, description: `Payment against Dues`, residentId: payment.userId, flatId: payment.flatId }
        ];

        return LedgerService.postJournalEntry({
            societyId, userId, userRole: "system", description: `Payment Received: ${payment.receiptNumber || 'Receipt'}`,
            transactionDate: payment.paymentDate || new Date(), referenceType: "PAYMENT", referenceId: payment._id, referenceNumber: payment.receiptNumber,
            lines, idempotencyKey: `PAY-${payment._id}`, isAutomatic: true, residentId: payment.userId, flatId: payment.flatId, db, session
        });
    }

    // 3. Advance payment (excess over dues)
    static async postAdvancePayment({ societyId, userId, payment, excessAmount, financialAccountId, db, session }) {
        const advanceAcc = await this.getSystemAccount(societyId, "2010", db);
        const bankAccId = await this.resolveBankOrCashGl(
            societyId,
            financialAccountId || payment.financialAccountId || payment.paymentAccountId,
            db,
            { preferCash: !isStrictObjectId(financialAccountId || payment.financialAccountId || payment.paymentAccountId)
                && String(payment.paymentMode || "").toUpperCase() === "CASH" }
        );

        const lines = [
            { accountId: bankAccId, debit: excessAmount, description: `Advance Received ${payment.receiptNumber || ''}`, residentId: payment.userId, flatId: payment.flatId },
            { accountId: advanceAcc, credit: excessAmount, description: `Excess/Advance Payment`, residentId: payment.userId, flatId: payment.flatId }
        ];

        return LedgerService.postJournalEntry({
            societyId, userId, userRole: "system", description: `Advance Payment: ${payment.receiptNumber || 'Receipt'}`,
            transactionDate: payment.paymentDate || new Date(), referenceType: "ADVANCE_RECEIVED", referenceId: payment._id, referenceNumber: payment.receiptNumber,
            lines, idempotencyKey: `ADV-${payment._id}`, isAutomatic: true, residentId: payment.userId, flatId: payment.flatId, db, session
        });
    }

    // 4. Advance auto-settles an invoice
    static async postAdvanceSettlement({ societyId, userId, invoice, advanceAmount, db, session }) {
        const advanceAcc = await this.getSystemAccount(societyId, "2010", db);
        const receivableAcc = await this.getSystemAccount(societyId, "1021", db);

        const lines = [
            { accountId: advanceAcc, debit: advanceAmount, description: `Advance applied to Inv ${invoice.invoiceNumber}`, residentId: invoice.userId, flatId: invoice.flatId },
            { accountId: receivableAcc, credit: advanceAmount, description: `Settlement by Advance`, residentId: invoice.userId, flatId: invoice.flatId }
        ];

        return LedgerService.postJournalEntry({
            societyId, userId, userRole: "system", description: `Advance Settlement for ${invoice.invoiceNumber}`,
            transactionDate: new Date(), referenceType: "ADVANCE_ALLOCATION", referenceId: invoice._id, referenceNumber: invoice.invoiceNumber,
            lines, idempotencyKey: `ADV-SETTLE-${invoice._id}`, isAutomatic: true, residentId: invoice.userId, flatId: invoice.flatId, db, session
        });
    }

    // 5. Fine or interest applied
    static async postFineApplied({ societyId, userId, fine, db, session }) {
        const receivableAcc = await this.getSystemAccount(societyId, "1021", db);
        const fineIncomeAcc = await this.getSystemAccount(societyId, "4040", db); // Late Fee Income

        const amount = Number(fine.amount ?? fine.fineAmount ?? 0);
        if (amount <= 0) return null;

        const lines = [
            { accountId: receivableAcc, debit: amount, description: `Fine/Interest Applied`, residentId: fine.userId, flatId: fine.flatId },
            { accountId: fineIncomeAcc, credit: amount, description: `Fine/Interest Income`, residentId: fine.userId, flatId: fine.flatId }
        ];

        return LedgerService.postJournalEntry({
            societyId, userId, userRole: "system", description: `Fine Applied: ${fine.reason || 'Late Fee'}`,
            transactionDate: fine.createdAt || new Date(), referenceType: "FINE", referenceId: fine._id,
            lines, idempotencyKey: `FINE-${fine._id}`, isAutomatic: true, residentId: fine.userId, flatId: fine.flatId, db, session
        });
    }

    // 6. Fine waived
    static async postFineWaived({ societyId, userId, fine, db, session }) {
        const receivableAcc = await this.getSystemAccount(societyId, "1021", db);
        const fineIncomeAcc = await this.getSystemAccount(societyId, "4040", db);

        const amount = Number(fine.amount ?? fine.waivedAmount ?? fine.fineAmount ?? 0);
        if (amount <= 0) return null;

        const lines = [
            { accountId: fineIncomeAcc, debit: amount, description: `Fine Waived: ${fine.waiveReason || fine.reason || ''}`, residentId: fine.userId, flatId: fine.flatId },
            { accountId: receivableAcc, credit: amount, description: `Fine Waiver Reversal`, residentId: fine.userId, flatId: fine.flatId }
        ];

        return LedgerService.postJournalEntry({
            societyId, userId, userRole: "admin", description: `Fine Waived: ${fine.reason || 'Late Fee'}`,
            transactionDate: new Date(), referenceType: "FINE", referenceId: fine._id,
            lines, idempotencyKey: `FINE-WAIVE-${fine._id}`, isAutomatic: true, residentId: fine.userId, flatId: fine.flatId, db, session
        });
    }

    // 7. Credit note
    static async postCreditNote({ societyId, userId, creditNote, db, session }) {
        const receivableAcc = await this.getSystemAccount(societyId, "1021", db);
        // Simplified: assuming reduction of generic income. Should strictly reverse exactly what was in the invoice.
        // But per rules: "Income (and GST Payable if applicable) / Members' Receivable"
        // For brevity and if GST split isn't on the credit note model, we put it entirely to Income or Discount. 
        // We will put it to Default Income (4010) unless specified.
        const incomeAcc = await this.getSystemAccount(societyId, "4010", db); 

        const lines = [
            { accountId: incomeAcc, debit: creditNote.amount, description: `Credit Note ${creditNote.noteNumber}`, residentId: creditNote.userId, flatId: creditNote.flatId },
            { accountId: receivableAcc, credit: creditNote.amount, description: `Credit Note ${creditNote.noteNumber}`, residentId: creditNote.userId, flatId: creditNote.flatId }
        ];

        return LedgerService.postJournalEntry({
            societyId, userId, userRole: "admin", description: `Credit Note Approved: ${creditNote.noteNumber}`,
            transactionDate: creditNote.approvedAt || new Date(), referenceType: "CREDIT_NOTE", referenceId: creditNote._id, referenceNumber: creditNote.noteNumber,
            lines, idempotencyKey: `CN-${creditNote._id}`, isAutomatic: true, residentId: creditNote.userId, flatId: creditNote.flatId, db, session
        });
    }

    // 8. Discount on an upcoming invoice
    static async postDiscount({ societyId, userId, discount, db, session }) {
        const receivableAcc = await this.getSystemAccount(societyId, "1021", db);
        const discountAcc = await this.getSystemAccount(societyId, "5060", db); // Discount Allowed

        const lines = [
            { accountId: discountAcc, debit: discount.amount, description: `Discount ${discount.discountCode || ''}`, residentId: discount.userId, flatId: discount.flatId },
            { accountId: receivableAcc, credit: discount.amount, description: `Discount Applied`, residentId: discount.userId, flatId: discount.flatId }
        ];

        return LedgerService.postJournalEntry({
            societyId, userId, userRole: "admin", description: `Discount Approved: ${discount.discountCode || ''}`,
            transactionDate: discount.approvedAt || new Date(), referenceType: "ADJUSTMENT", referenceId: discount._id,
            lines, idempotencyKey: `DISC-${discount._id}`, isAutomatic: true, residentId: discount.userId, flatId: discount.flatId, db, session
        });
    }

    // 9. Security deposit received
    static async postSecurityDepositReceived({ societyId, userId, deposit, financialAccountId, db, session }) {
        const sdAcc = await this.getSystemAccount(societyId, "2020", db);
        const bankAccId = await this.resolveBankOrCashGl(societyId, financialAccountId, db);

        const lines = [
            { accountId: bankAccId, debit: deposit.amount, description: `Security Deposit Received`, residentId: deposit.userId || deposit.residentId, flatId: deposit.flatId },
            { accountId: sdAcc, credit: deposit.amount, description: `Security Deposit`, residentId: deposit.userId || deposit.residentId, flatId: deposit.flatId }
        ];

        return LedgerService.postJournalEntry({
            societyId, userId, userRole: "system", description: `Security Deposit Received`,
            transactionDate: deposit.paymentDate || new Date(), referenceType: "SECURITY_DEPOSIT", referenceId: deposit._id,
            lines, idempotencyKey: `SD-REC-${deposit._id}`, isAutomatic: true, residentId: deposit.userId, flatId: deposit.flatId, db, session
        });
    }

    // 9b. Security deposit refund
    static async postSecurityDepositRefund({ societyId, userId, deposit, financialAccountId, db, session }) {
        const sdAcc = await this.getSystemAccount(societyId, "2020", db);
        const bankAccId = await this.resolveBankOrCashGl(societyId, financialAccountId, db);

        const lines = [
            { accountId: sdAcc, debit: deposit.amount, description: `Security Deposit Refund`, residentId: deposit.userId || deposit.residentId, flatId: deposit.flatId },
            { accountId: bankAccId, credit: deposit.amount, description: `Security Deposit Refund`, residentId: deposit.userId || deposit.residentId, flatId: deposit.flatId }
        ];

        return LedgerService.postJournalEntry({
            societyId, userId, userRole: "admin", description: `Security Deposit Refunded`,
            transactionDate: new Date(), referenceType: "DEPOSIT_REFUND", referenceId: deposit._id,
            lines, idempotencyKey: `SD-REF-${deposit._id}`, isAutomatic: true, residentId: deposit.userId, flatId: deposit.flatId, db, session
        });
    }

    // 10. Vendor payment
    static async postVendorPayment({ societyId, userId, payment, db, session }) {
        const expenseAcc = payment.ledgerAccountId
            || await this.getSystemAccount(societyId, "5070", db);
        const bankAccId = await this.resolveBankOrCashGl(
            societyId,
            payment.financialAccountId,
            db,
            { preferCash: String(payment.paymentMode || "").toLowerCase() === "cash" }
        );

        const lines = [
            { accountId: expenseAcc, debit: payment.amount, description: `Vendor payment ${payment.paymentNumber || payment.reference || ''}` },
            { accountId: bankAccId, credit: payment.amount, description: `Vendor Payment Disbursal` }
        ];

        return LedgerService.postJournalEntry({
            societyId, userId, userRole: "admin", description: `Vendor Payment Disbursed: ${payment.reference || ''}`,
            transactionDate: payment.paymentDate || new Date(), referenceType: "EXPENSE", referenceId: payment._id,
            lines, idempotencyKey: `VEND-PAY-${payment._id}`, isAutomatic: true, db, session
        });
    }

    // 11. Petty cash expense
    static async postPettyCashExpense({ societyId, userId, expense, db, session }) {
        const cashAcc = await this.getSystemAccount(societyId, "1011", db); // Cash in Hand
        const defaultExpenseAcc = await this.getSystemAccount(societyId, "5070", db); // Other Expenses
        
        const lines = [
            { accountId: expense.ledgerAccountId || defaultExpenseAcc, debit: expense.amount, description: `Petty Cash: ${expense.description}` },
            { accountId: cashAcc, credit: expense.amount, description: `Petty Cash Disbursal` }
        ];

        return LedgerService.postJournalEntry({
            societyId, userId, userRole: "admin", description: `Petty Cash Expense: ${expense.description}`,
            transactionDate: expense.date || new Date(), referenceType: "EXPENSE", referenceId: expense._id,
            lines, idempotencyKey: `PETTY-${expense._id}`, isAutomatic: true, db, session
        });
    }

    // 12. Sundry/miscellaneous income
    static async postSundryIncome({ societyId, userId, income, db, session }) {
        const sundryIncomeAcc = await this.getSystemAccount(societyId, "4060", db);
        const bankAccId = await this.resolveBankOrCashGl(societyId, income.financialAccountId, db);

        const lines = [
            { accountId: bankAccId, debit: income.amount, description: `Sundry Income Received` },
            { accountId: sundryIncomeAcc, credit: income.amount, description: `Sundry Income: ${income.description}` }
        ];

        return LedgerService.postJournalEntry({
            societyId, userId, userRole: "system", description: `Sundry Income: ${income.description}`,
            transactionDate: income.date || new Date(), referenceType: "MANUAL", referenceId: income._id,
            lines, idempotencyKey: `SUNDRY-${income._id}`, isAutomatic: true, db, session
        });
    }

    // 13. Unmatched online payment (no invoice allocated yet)
    static async postUnmatchedPayment({ societyId, userId, payment, db, session }) {
        const unallocatedAcc = await this.getSystemAccount(societyId, "2070", db);
        const bankAccId = await this.resolveBankOrCashGl(
            societyId,
            payment.financialAccountId || payment.paymentAccountId,
            db
        );

        const lines = [
            { accountId: bankAccId, debit: payment.amount, description: `Unmatched Payment ${payment.paymentNumber || payment.reference || ''}` },
            { accountId: unallocatedAcc, credit: payment.amount, description: `Unallocated Receipts` }
        ];

        return LedgerService.postJournalEntry({
            societyId, userId, userRole: "system", description: `Unmatched Payment: ${payment.paymentNumber || payment.reference || ''}`,
            transactionDate: payment.paymentDate || new Date(), referenceType: "PAYMENT", referenceId: payment._id, referenceNumber: payment.paymentNumber || payment.reference,
            lines, idempotencyKey: `UNMATCH-${payment._id}`, isAutomatic: true, db, session
        });
    }

    /**
     * Confirmed collection: dues vs AR, excess vs advance, no-invoice vs unallocated.
     * Does not post INITIATED/pending gateway payments.
     */
    static async postConfirmedCollection({ societyId, userId, payment, financialAccountId, db, session }) {
        const plain = payment && typeof payment.toObject === "function" ? payment.toObject() : { ...payment };
        const total = Number(plain.amount || 0);
        if (total <= 0) return null;

        const excess = Number(plain.excessAmount || 0);
        const hasInvoice = Boolean(plain.invoiceId);
        const applied = hasInvoice ? Math.max(0, total - excess) : 0;

        if (!hasInvoice) {
            return this.postUnmatchedPayment({ societyId, userId, payment: plain, db, session });
        }

        const fa = financialAccountId || plain.financialAccountId || plain.paymentAccountId;
        if (applied > 0) {
            await this.postPaymentReceived({
                societyId, userId,
                payment: { ...plain, amount: applied },
                financialAccountId: fa, db, session
            });
        }
        if (excess > 0) {
            await this.postAdvancePayment({
                societyId, userId, payment: plain, excessAmount: excess,
                financialAccountId: fa, db, session
            });
        }
        return true;
    }

    // 14. Cancelled or failed payment (Reversal)
    static async postPaymentReversal({ societyId, userId, paymentId, reason, db, session }) {
        const { JournalEntry } = getLedgerModels(db);
        const originals = await JournalEntry.find({
            societyId,
            referenceId: String(paymentId),
            referenceType: { $in: ["PAYMENT", "ADVANCE_RECEIVED"] },
            status: "POSTED"
        }).lean();
        if (!originals.length) return null;
        let last = null;
        for (const original of originals) {
            last = await LedgerService.reverseJournalEntry(societyId, userId, "system", original._id, reason || "Payment Cancelled/Failed", db);
        }
        return last;
    }

    static async postInvoiceReversal({ societyId, userId, invoiceId, reason, db }) {
        const { JournalEntry } = getLedgerModels(db);
        const original = await JournalEntry.findOne({
            societyId,
            referenceId: String(invoiceId),
            referenceType: "INVOICE",
            status: "POSTED"
        }).lean();
        if (!original) return null;
        return LedgerService.reverseJournalEntry(societyId, userId, "system", original._id, reason || "Invoice cancelled", db);
    }

    // Bank / petty-cash reconciliation adjustments (charges, interest, shortage, excess)
    static async postReconciliationAdjustment({ societyId, userId, adjustment, financialAccountId, db, session }) {
        const amount = Number(adjustment.amount || 0);
        if (amount <= 0) return null;

        const bankAccId = await this.resolveBankOrCashGl(societyId, financialAccountId || adjustment.accountId, db);
        const type = String(adjustment.adjustmentType || "").toUpperCase();
        const incomeAcc = await this.getSystemAccount(societyId, type === "BANK_INTEREST" ? "4050" : "4060", db);
        const expenseAcc = await this.getSystemAccount(societyId, "5070", db);

        const increasesCash = ["BANK_INTEREST", "CASH_EXCESS"].includes(type);
        const lines = increasesCash
            ? [
                { accountId: bankAccId, debit: amount, description: adjustment.description || type },
                { accountId: incomeAcc, credit: amount, description: adjustment.reason || type },
            ]
            : [
                { accountId: expenseAcc, debit: amount, description: adjustment.reason || type },
                { accountId: bankAccId, credit: amount, description: adjustment.description || type },
            ];

        return LedgerService.postJournalEntry({
            societyId, userId, userRole: "admin",
            description: `Reconciliation adjustment: ${type}`,
            transactionDate: adjustment.adjustmentDate || new Date(),
            referenceType: "ADJUSTMENT",
            referenceId: adjustment._id,
            referenceNumber: adjustment.adjustmentNumber,
            lines,
            idempotencyKey: `RECON-ADJ-${adjustment._id}`,
            isAutomatic: true, db, session
        });
    }

    static async postInternalTransfer({ societyId, userId, transfer, fromFinancialAccountId, toFinancialAccountId, db, session }) {
        const amount = Number(transfer.amount || 0);
        if (amount <= 0) return null;

        const fromGl = await this.resolveBankOrCashGl(societyId, fromFinancialAccountId, db);
        const toGl = await this.resolveBankOrCashGl(societyId, toFinancialAccountId, db);
        if (String(fromGl) === String(toGl)) return null;

        const lines = [
            { accountId: toGl, debit: amount, description: `Transfer in ${transfer.transferNumber || ''}` },
            { accountId: fromGl, credit: amount, description: `Transfer out ${transfer.transferNumber || ''}` },
        ];

        return LedgerService.postJournalEntry({
            societyId, userId, userRole: "admin",
            description: `Internal transfer ${transfer.transferNumber || ''}`,
            transactionDate: transfer.transferDate || new Date(),
            referenceType: "TRANSFER",
            referenceId: transfer._id,
            referenceNumber: transfer.transferNumber,
            lines,
            idempotencyKey: `XFER-${transfer._id}`,
            isAutomatic: true, db, session
        });
    }
}

module.exports = LedgerPostingService;
