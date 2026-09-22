"use strict";

const mongoose = require("mongoose");

// â”€â”€ 1. FinancialAccount Schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const financialAccountSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: true,
            index: true
        },
        accountName: {
            type: String,
            required: [true, "Account name is required"],
            trim: true
        },
        accountType: {
            type: String,
            enum: ["BANK", "CASH"],
            required: true,
            index: true
        },
        bankName: {
            type: String,
            trim: true,
            default: null
        },
        accountNumber: {
            type: String,
            trim: true,
            default: null
        },
        maskedAccountNumber: {
            type: String,
            trim: true,
            default: null
        },
        ifsc: {
            type: String,
            trim: true,
            uppercase: true,
            default: null
        },
        branchName: {
            type: String,
            trim: true,
            default: null
        },
        accountHolderName: {
            type: String,
            trim: true,
            default: null
        },
        cashLocation: {
            type: String,
            trim: true,
            default: null
        },
        openingBalance: {
            type: Number,
            default: 0
        },
        currentBalance: {
            type: Number,
            default: 0
        },
        status: {
            type: String,
            enum: ["ACTIVE", "INACTIVE"],
            default: "ACTIVE",
            index: true
        },
        lastReconciledDate: {
            type: Date,
            default: null
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        }
    },
    { timestamps: true }
);

financialAccountSchema.index({ societyId: 1, status: 1 });
financialAccountSchema.index({ societyId: 1, accountType: 1 });

// Helper to mask account number before save
financialAccountSchema.pre("save", async function () {
    if (this.accountType === "BANK" && this.accountNumber && this.accountNumber.length > 4) {
        const last4 = this.accountNumber.slice(-4);
        this.maskedAccountNumber = `XXXX XXXX ${last4}`;
    } else if (this.accountType === "CASH") {
        this.maskedAccountNumber = "CASH-ACCOUNT";
    }
});

// â”€â”€ 2. AccountTransaction Schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const accountTransactionSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: true,
            index: true
        },
        accountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "FinancialAccount",
            required: true,
            index: true
        },
        transactionNumber: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        transactionType: {
            type: String,
            enum: ["PAYMENT", "EXPENSE", "REFUND", "TRANSFER_IN", "TRANSFER_OUT", "ADJUSTMENT", "OPENING_BALANCE", "BANK_CHARGE", "BANK_INTEREST"],
            required: true,
            index: true
        },
        direction: {
            type: String,
            enum: ["CREDIT", "DEBIT"],
            required: true
        },
        transactionDate: {
            type: Date,
            required: true,
            index: true
        },
        amount: {
            type: Number,
            required: true,
            min: 0.01
        },
        balanceAfterTransaction: {
            type: Number,
            required: true
        },
        paymentMethod: {
            type: String,
            enum: ["UPI", "CARD", "NET_BANKING", "CASH", "CHEQUE", "BANK_TRANSFER", "INTERNAL_TRANSFER", "SYSTEM_ADJUSTMENT"],
            default: "BANK_TRANSFER"
        },
        referenceType: {
            type: String,
            enum: ["PAYMENT", "EXPENSE", "TRANSFER", "ADJUSTMENT", "MANUAL", "STATEMENT"],
            default: "MANUAL"
        },
        referenceId: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: "referenceModel"
        },
        referenceModel: {
            type: String,
            enum: ["Payment", "Expense", "AccountTransfer", "ReconciliationAdjustment"]
        },
        externalReference: {
            type: String,
            default: null,
            index: true
        },
        residentVendorName: {
            type: String,
            default: null
        },
        invoiceExpenseRef: {
            type: String,
            default: null
        },
        description: {
            type: String,
            required: true
        },
        reconciliationStatus: {
            type: String,
            enum: ["UNRECONCILED", "RECONCILED", "MATCHED", "PARTIALLY_MATCHED", "MANUAL_MATCH", "EXCLUDED"],
            default: "UNRECONCILED",
            index: true
        },
        reconciliationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ReconciliationSession",
            default: null
        },
        statementTransactionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "BankStatementTransaction",
            default: null
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        }
    },
    { timestamps: true }
);

accountTransactionSchema.index({ societyId: 1, accountId: 1, transactionDate: -1 });
accountTransactionSchema.index({ societyId: 1, reconciliationStatus: 1 });
accountTransactionSchema.index({ societyId: 1, externalReference: 1 });

// â”€â”€ 3. BankStatement Schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const bankStatementSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: true,
            index: true
        },
        accountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "FinancialAccount",
            required: true,
            index: true
        },
        statementPeriodStart: {
            type: Date,
            required: true
        },
        statementPeriodEnd: {
            type: Date,
            required: true
        },
        openingBalance: {
            type: Number,
            required: true
        },
        closingBalance: {
            type: Number,
            required: true
        },
        totalCreditRows: {
            type: Number,
            default: 0
        },
        totalDebitRows: {
            type: Number,
            default: 0
        },
        importedFile: {
            fileName: String,
            fileUrl: String,
            fileType: String
        },
        status: {
            type: String,
            enum: ["IMPORTED", "IN_RECONCILIATION", "RECONCILED", "CANCELLED"],
            default: "IMPORTED",
            index: true
        },
        importedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        }
    },
    { timestamps: true }
);

bankStatementSchema.index({ societyId: 1, accountId: 1, statementPeriodEnd: -1 });

// â”€â”€ 4. BankStatementTransaction Schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const bankStatementTransactionSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: true,
            index: true
        },
        statementId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "BankStatement",
            required: true,
            index: true
        },
        accountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "FinancialAccount",
            required: true,
            index: true
        },
        transactionDate: {
            type: Date,
            required: true
        },
        description: {
            type: String,
            required: true
        },
        referenceNumber: {
            type: String,
            default: null,
            index: true
        },
        debit: {
            type: Number,
            default: 0
        },
        credit: {
            type: Number,
            default: 0
        },
        balance: {
            type: Number,
            default: 0
        },
        matchingStatus: {
            type: String,
            enum: ["UNMATCHED", "AUTO_MATCHED", "MANUALLY_MATCHED", "EXCLUDED", "DIFFERENCE_RECORDED"],
            default: "UNMATCHED",
            index: true
        },
        matchedTransactionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AccountTransaction",
            default: null
        },
        confidenceScore: {
            type: Number,
            default: 0 // 0 to 100
        },
        matchReason: {
            type: String,
            default: null
        }
    },
    { timestamps: true }
);

bankStatementTransactionSchema.index({ societyId: 1, statementId: 1, matchingStatus: 1 });
bankStatementTransactionSchema.index({ societyId: 1, accountId: 1, referenceNumber: 1 });

// â”€â”€ 5. ReconciliationSession Schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const reconciliationSessionSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: true,
            index: true
        },
        accountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "FinancialAccount",
            required: true,
            index: true
        },
        statementId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "BankStatement",
            default: null
        },
        reconciliationNumber: {
            type: String,
            required: true,
            unique: true
        },
        periodStart: {
            type: Date,
            required: true
        },
        periodEnd: {
            type: Date,
            required: true
        },
        openingBalance: {
            type: Number,
            required: true
        },
        statementClosingBalance: {
            type: Number,
            required: true
        },
        ledgerClosingBalance: {
            type: Number,
            required: true
        },
        difference: {
            type: Number,
            required: true
        },
        matchedCount: {
            type: Number,
            default: 0
        },
        unmatchedCount: {
            type: Number,
            default: 0
        },
        adjustmentsTotal: {
            type: Number,
            default: 0
        },
        status: {
            type: String,
            enum: ["DRAFT", "DIFFERENCE_PENDING", "SUBMITTED", "APPROVED", "FINALIZED"],
            default: "DRAFT",
            index: true
        },
        submittedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        approvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        finalizedAt: {
            type: Date,
            default: null
        }
    },
    { timestamps: true }
);

reconciliationSessionSchema.index({ societyId: 1, accountId: 1, status: 1 });

// â”€â”€ 6. AccountTransfer Schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const accountTransferSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: true,
            index: true
        },
        transferNumber: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        fromAccountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "FinancialAccount",
            required: true,
            index: true
        },
        toAccountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "FinancialAccount",
            required: true,
            index: true
        },
        amount: {
            type: Number,
            required: true,
            min: 0.01
        },
        transferDate: {
            type: Date,
            required: true
        },
        referenceNumber: {
            type: String,
            required: true
        },
        description: {
            type: String,
            required: true
        },
        transferType: {
            type: String,
            enum: ["BANK_TO_BANK", "CASH_TO_BANK", "BANK_TO_CASH", "CASH_TO_CASH"],
            required: true
        },
        status: {
            type: String,
            enum: ["COMPLETED", "REVERSED", "CANCELLED"],
            default: "COMPLETED",
            index: true
        },
        outTransactionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AccountTransaction"
        },
        inTransactionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AccountTransaction"
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        }
    },
    { timestamps: true }
);

accountTransferSchema.index({ societyId: 1, fromAccountId: 1, toAccountId: 1 });

// â”€â”€ 7. ReconciliationAdjustment Schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const reconciliationAdjustmentSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: true,
            index: true
        },
        accountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "FinancialAccount",
            required: true,
            index: true
        },
        adjustmentNumber: {
            type: String,
            required: true,
            unique: true
        },
        adjustmentDate: {
            type: Date,
            required: true
        },
        amount: {
            type: Number,
            required: true,
            min: 0.01
        },
        adjustmentType: {
            type: String,
            enum: ["BANK_CHARGE", "BANK_INTEREST", "CASH_SHORTAGE", "CASH_EXCESS", "CORRECTION", "TIMING_DIFFERENCE", "OTHER"],
            required: true,
            index: true
        },
        direction: {
            type: String,
            enum: ["CREDIT", "DEBIT"],
            required: true
        },
        description: {
            type: String,
            required: true
        },
        reason: {
            type: String,
            required: true
        },
        referenceNumber: {
            type: String,
            default: null
        },
        reconciliationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ReconciliationSession",
            default: null
        },
        transactionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AccountTransaction",
            default: null
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        }
    },
    { timestamps: true }
);

reconciliationAdjustmentSchema.index({ societyId: 1, accountId: 1 });

// â”€â”€ 8. CashCount Schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const cashCountSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: true,
            index: true
        },
        accountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "FinancialAccount",
            required: true,
            index: true
        },
        countDate: {
            type: Date,
            required: true,
            default: Date.now
        },
        denominations: [
            {
                denomination: { type: Number, required: true }, // 2000, 500, 200, 100, 50, 20, 10, 5, 2, 1
                quantity: { type: Number, required: true, min: 0 },
                totalAmount: { type: Number, required: true }
            }
        ],
        expectedCash: {
            type: Number,
            required: true
        },
        actualCash: {
            type: Number,
            required: true
        },
        cashDifference: {
            type: Number,
            required: true
        },
        notes: String,
        status: {
            type: String,
            enum: ["COUNTED", "RECONCILED", "DIFFERENCE_ADJUSTED"],
            default: "COUNTED"
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        }
    },
    { timestamps: true }
);

cashCountSchema.index({ societyId: 1, accountId: 1, countDate: -1 });

function getReconciliationModels(db) {
    if (!db) {
        const { getOperationsConnection } = require("../../config/operationsDb");
        db = getOperationsConnection();
    }
    return {
        FinancialAccount:         db.models.FinancialAccount         || db.model("FinancialAccount",         financialAccountSchema),
        AccountTransaction:       db.models.AccountTransaction       || db.model("AccountTransaction",       accountTransactionSchema),
        BankStatement:            db.models.BankStatement            || db.model("BankStatement",            bankStatementSchema),
        BankStatementTransaction: db.models.BankStatementTransaction || db.model("BankStatementTransaction", bankStatementTransactionSchema),
        ReconciliationSession:    db.models.ReconciliationSession    || db.model("ReconciliationSession",    reconciliationSessionSchema),
        AccountTransfer:          db.models.AccountTransfer          || db.model("AccountTransfer",          accountTransferSchema),
        ReconciliationAdjustment: db.models.ReconciliationAdjustment || db.model("ReconciliationAdjustment", reconciliationAdjustmentSchema),
        CashCount:                db.models.CashCount                || db.model("CashCount",                cashCountSchema),
    };
}

module.exports = { getReconciliationModels };
