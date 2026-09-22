"use strict";

const { getOperationsConnection } = require("../../config/operationsDb");
const { sendSuccess, sendError } = require("../../utils/response.utils");
const createAuditLog = require("../../utils/auditLog");
const { getReconciliationModels } = require("./reconciliation.model");

// Helper to generate unique codes
const generateCode = (prefix) => `${prefix}-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

// Resolve models from the operations DB connection
const getModels = () => getReconciliationModels(getOperationsConnection());

// ── 1. Financial Accounts ───────────────────────────────────────────────────

/**
 * List all financial accounts for a society with summary metrics
 */
const getAccounts = async (req, res, next) => {
    try {
        const societyId = req.societyId || req.query.societyId;
        if (!societyId) return sendError(res, 400, "Society ID is required");

        const { status, type } = req.query;
        const query = { societyId };
        if (status) query.status = status;
        if (type) query.accountType = type;

        const models = getModels();
        const accounts = await models.FinancialAccount.find(query).sort({ createdAt: -1 }).lean();

        // Calculate summary cards metrics
        let totalBankBalance = 0;
        let totalCashBalance = 0;

        accounts.forEach(acc => {
            if (acc.status === "ACTIVE") {
                if (acc.accountType === "BANK") totalBankBalance += (acc.currentBalance || 0);
                if (acc.accountType === "CASH") totalCashBalance += (acc.currentBalance || 0);
            }
        });

        return sendSuccess(res, 200, "Financial accounts retrieved successfully", {
            summary: {
                totalBankBalance,
                totalCashBalance,
                ledgerBalance: totalBankBalance + totalCashBalance
            },
            accounts
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Create a new bank or cash account
 */
const createAccount = async (req, res, next) => {
    try {
        const societyId = req.societyId || req.body.societyId;
        const userId = req.user.id;

        const {
            accountName,
            accountType,
            bankName,
            accountNumber,
            ifsc,
            branchName,
            accountHolderName,
            cashLocation,
            openingBalance
        } = req.body;

        if (!accountName || !accountType) {
            return sendError(res, 400, "Account name and type (BANK/CASH) are required");
        }

        const initialBalance = Number(openingBalance) || 0;
        const models = getModels();

        const account = new models.FinancialAccount({
            societyId,
            accountName,
            accountType,
            bankName: accountType === "BANK" ? bankName : null,
            accountNumber: accountType === "BANK" ? accountNumber : null,
            ifsc: accountType === "BANK" ? ifsc : null,
            branchName: accountType === "BANK" ? branchName : null,
            accountHolderName: accountType === "BANK" ? accountHolderName : null,
            cashLocation: accountType === "CASH" ? cashLocation : null,
            openingBalance: initialBalance,
            currentBalance: initialBalance,
            createdBy: userId
        });

        await account.save();

        // If opening balance > 0, create an initial transaction entry
        if (initialBalance !== 0) {
            const tx = new models.AccountTransaction({
                societyId,
                accountId: account._id,
                transactionNumber: generateCode("TX-OPN"),
                transactionType: "OPENING_BALANCE",
                direction: initialBalance > 0 ? "CREDIT" : "DEBIT",
                transactionDate: new Date(),
                amount: Math.abs(initialBalance),
                balanceAfterTransaction: initialBalance,
                paymentMethod: "SYSTEM_ADJUSTMENT",
                referenceType: "MANUAL",
                description: `Opening Balance for ${accountName}`,
                reconciliationStatus: "RECONCILED",
                createdBy: userId
            });
            await tx.save();
        }

        await createAuditLog({
            societyId,
            userId,
            action: "ACCOUNT_CREATED",
            entityType: "FinancialAccount",
            entityId: account._id,
            newValue: { accountName, accountType, openingBalance: initialBalance },
            req
        });

        return sendSuccess(res, 201, "Financial account created successfully", account);
    } catch (err) {
        next(err);
    }
};

/**
 * Update account details
 */
const updateAccount = async (req, res, next) => {
    try {
        const { id } = req.params;
        const societyId = req.societyId;
        const userId = req.user.id;

        const models = getModels();
        const account = await models.FinancialAccount.findOne({ _id: id, societyId });
        if (!account) return sendError(res, 404, "Financial account not found");

        const allowedFields = ["accountName", "bankName", "ifsc", "branchName", "accountHolderName", "cashLocation"];
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) account[field] = req.body[field];
        });
        account.updatedBy = userId;

        await account.save();

        await createAuditLog({
            societyId,
            userId,
            action: "ACCOUNT_UPDATED",
            entityType: "FinancialAccount",
            entityId: account._id,
            newValue: req.body,
            req
        });

        return sendSuccess(res, 200, "Account updated successfully", account);
    } catch (err) {
        next(err);
    }
};

/**
 * Toggle Account status ACTIVE <-> INACTIVE (Soft Delete)
 */
const toggleAccountStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const societyId = req.societyId;
        const userId = req.user.id;

        if (!["ACTIVE", "INACTIVE"].includes(status)) {
            return sendError(res, 400, "Invalid status. Must be ACTIVE or INACTIVE");
        }

        const models = getModels();
        const account = await models.FinancialAccount.findOne({ _id: id, societyId });
        if (!account) return sendError(res, 404, "Financial account not found");

        account.status = status;
        account.updatedBy = userId;
        await account.save();

        await createAuditLog({
            societyId,
            userId,
            action: "ACCOUNT_DEACTIVATED",
            entityType: "FinancialAccount",
            entityId: account._id,
            newValue: { status },
            req
        });

        return sendSuccess(res, 200, `Account status updated to ${status}`, account);
    } catch (err) {
        next(err);
    }
};

// ── 2. Account Transactions ─────────────────────────────────────────────────

/**
 * Server-side paginated & filtered account transactions query
 */
const getAccountTransactions = async (req, res, next) => {
    try {
        const societyId = req.societyId || req.query.societyId;
        const {
            accountId,
            transactionType,
            reconciliationStatus,
            paymentMethod,
            startDate,
            endDate,
            search,
            page = 1,
            limit = 20
        } = req.query;

        const query = { societyId };
        if (accountId) query.accountId = accountId;
        if (transactionType) query.transactionType = transactionType;
        if (reconciliationStatus) query.reconciliationStatus = reconciliationStatus;
        if (paymentMethod) query.paymentMethod = paymentMethod;

        if (startDate || endDate) {
            query.transactionDate = {};
            if (startDate) query.transactionDate.$gte = new Date(startDate);
            if (endDate) query.transactionDate.$lte = new Date(endDate);
        }

        if (search) {
            query.$or = [
                { transactionNumber: new RegExp(search, "i") },
                { description: new RegExp(search, "i") },
                { externalReference: new RegExp(search, "i") },
                { residentVendorName: new RegExp(search, "i") }
            ];
        }

        const models = getModels();
        const skip = (Number(page) - 1) * Number(limit);
        const [transactions, total] = await Promise.all([
            models.AccountTransaction.find(query)
                .sort({ transactionDate: -1, createdAt: -1 })
                .skip(skip)
                .limit(Number(limit))
                .populate("accountId", "accountName accountType maskedAccountNumber")
                .lean(),
            models.AccountTransaction.countDocuments(query)
        ]);

        return sendSuccess(res, 200, "Transactions fetched successfully", {
            transactions,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit),
                pages: Math.ceil(total / Number(limit))
            }
        });
    } catch (err) {
        next(err);
    }
};

// ── 3. Bank Statement Import & Matching ─────────────────────────────────────

/**
 * Import bank statement rows (JSON parsed from CSV/XLSX by FE)
 */
const importBankStatement = async (req, res, next) => {
    try {
        const societyId = req.societyId;
        const userId = req.user.id;
        const {
            accountId,
            statementPeriodStart,
            statementPeriodEnd,
            openingBalance,
            closingBalance,
            rows // Array of { transactionDate, description, referenceNumber, debit, credit, balance }
        } = req.body;

        if (!accountId || !rows || !Array.isArray(rows) || rows.length === 0) {
            return sendError(res, 400, "Invalid payload. Account ID and non-empty rows array required");
        }

        const models = getModels();
        const account = await models.FinancialAccount.findOne({ _id: accountId, societyId });
        if (!account) return sendError(res, 404, "Financial account not found");
        if (account.accountType !== "BANK") {
            return sendError(res, 400, "Statements can only be imported for BANK accounts");
        }

        // Validate rows server side
        const validRows = [];
        const errors = [];

        const parseFlexibleDate = (str) => {
            if (!str) return new Date();
            const s = String(str).trim();
            const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
            if (dmy) {
                return new Date(`${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`);
            }
            return new Date(s);
        };

        rows.forEach((row, idx) => {
            const tDate = parseFlexibleDate(row.transactionDate);
            const dr = Number(row.debit) || 0;
            const cr = Number(row.credit) || 0;

            if (isNaN(tDate.getTime())) {
                errors.push(`Row ${idx + 1}: Invalid date ${row.transactionDate}`);
            } else if (dr < 0 || cr < 0) {
                errors.push(`Row ${idx + 1}: Negative debit or credit values not permitted`);
            } else {
                validRows.push({
                    societyId,
                    accountId,
                    transactionDate: tDate,
                    description: row.description || "Bank Statement Entry",
                    referenceNumber: row.referenceNumber || null,
                    debit: dr,
                    credit: cr,
                    balance: Number(row.balance) || 0
                });
            }
        });

        if (errors.length > 0) {
            return sendError(res, 422, "Statement validation failed", { errors });
        }

        // Save Statement Header
        const statement = new models.BankStatement({
            societyId,
            accountId,
            statementPeriodStart: new Date(statementPeriodStart),
            statementPeriodEnd: new Date(statementPeriodEnd),
            openingBalance: Number(openingBalance) || 0,
            closingBalance: Number(closingBalance) || 0,
            totalCreditRows: validRows.filter(r => r.credit > 0).length,
            totalDebitRows: validRows.filter(r => r.debit > 0).length,
            importedBy: userId
        });
        await statement.save();

        // Save Statement Transactions with statementId link
        const stmtTxDocs = validRows.map(r => ({ ...r, statementId: statement._id }));
        const insertedStmtTxs = await models.BankStatementTransaction.insertMany(stmtTxDocs);

        // Perform Automatic Matching Logic
        let autoMatchCount = 0;
        const systemTransactions = await models.AccountTransaction.find({
            societyId,
            accountId,
            reconciliationStatus: "UNRECONCILED"
        });

        for (const stmtTx of insertedStmtTxs) {
            // Match Criteria: Reference Number OR (Amount + Date within 2 days)
            let matched = null;
            let matchReason = "";
            let score = 0;

            if (stmtTx.referenceNumber) {
                matched = systemTransactions.find(
                    tx => tx.externalReference && tx.externalReference.trim() === stmtTx.referenceNumber.trim()
                );
                if (matched) {
                    matchReason = "Exact Reference Number Match";
                    score = 100;
                }
            }

            if (!matched) {
                const stmtAmount = stmtTx.credit > 0 ? stmtTx.credit : stmtTx.debit;
                const stmtDirection = stmtTx.credit > 0 ? "CREDIT" : "DEBIT";

                matched = systemTransactions.find(tx => {
                    const amountMatch = Math.abs(tx.amount - stmtAmount) < 0.01;
                    const directionMatch = tx.direction === stmtDirection;
                    const dateDiffDays = Math.abs(new Date(tx.transactionDate) - new Date(stmtTx.transactionDate)) / (1000 * 60 * 60 * 24);
                    return amountMatch && directionMatch && dateDiffDays <= 2;
                });

                if (matched) {
                    matchReason = "Amount and Date Proximity Match";
                    score = 85;
                }
            }

            if (matched) {
                stmtTx.matchingStatus = "AUTO_MATCHED";
                stmtTx.matchedTransactionId = matched._id;
                stmtTx.confidenceScore = score;
                stmtTx.matchReason = matchReason;
                await stmtTx.save();

                matched.reconciliationStatus = "MATCHED";
                matched.statementTransactionId = stmtTx._id;
                await matched.save();

                autoMatchCount++;
            }
        }

        await createAuditLog({
            societyId,
            userId,
            action: "STATEMENT_IMPORTED",
            entityType: "BankStatement",
            entityId: statement._id,
            newValue: { totalRows: validRows.length, autoMatchCount },
            req
        });

        return sendSuccess(res, 201, "Bank statement imported & auto-matched successfully", {
            statementId: statement._id,
            totalRows: validRows.length,
            autoMatchCount,
            unmatchedCount: validRows.length - autoMatchCount
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Get statement transactions for matching view
 */
const getStatementTransactions = async (req, res, next) => {
    try {
        const { statementId } = req.params;
        const societyId = req.societyId;

        const models = getModels();
        const transactions = await models.BankStatementTransaction.find({ statementId, societyId })
            .populate("matchedTransactionId")
            .sort({ transactionDate: 1 })
            .lean();

        return sendSuccess(res, 200, "Bank statement transactions retrieved", transactions);
    } catch (err) {
        next(err);
    }
};

/**
 * Manual Match a Bank Statement Transaction with a System Transaction
 */
const manualMatchTransaction = async (req, res, next) => {
    try {
        const { statementTransactionId, systemTransactionId } = req.body;
        const societyId = req.societyId;
        const userId = req.user.id;

        const models = getModels();
        const stmtTx = await models.BankStatementTransaction.findOne({ _id: statementTransactionId, societyId });
        if (!stmtTx) return sendError(res, 404, "Bank statement transaction not found");

        const sysTx = await models.AccountTransaction.findOne({ _id: systemTransactionId, societyId });
        if (!sysTx) return sendError(res, 404, "System transaction not found");

        stmtTx.matchingStatus = "MANUALLY_MATCHED";
        stmtTx.matchedTransactionId = sysTx._id;
        stmtTx.confidenceScore = 100;
        stmtTx.matchReason = "Manual Match by User";
        await stmtTx.save();

        sysTx.reconciliationStatus = "MANUAL_MATCH";
        sysTx.statementTransactionId = stmtTx._id;
        await sysTx.save();

        await createAuditLog({
            societyId,
            userId,
            action: "MANUAL_MATCH_CREATED",
            entityType: "BankStatementTransaction",
            entityId: stmtTx._id,
            newValue: { matchedWithTxId: sysTx._id },
            req
        });

        return sendSuccess(res, 200, "Transaction manually matched successfully", { stmtTx, sysTx });
    } catch (err) {
        next(err);
    }
};

// ── 4. Account Transfers (Bank <-> Bank, Cash <-> Bank, Cash <-> Cash) ────

/**
 * Create transactional internal transfer between two society accounts
 */
const createTransfer = async (req, res, next, _skipSession = false) => {
    const conn = getOperationsConnection();
    let session = null;
    let useTransaction = false; // default OFF; only enable if replica set is available

    if (!_skipSession) {
        try {
            session = await conn.startSession();
            session.startTransaction();
            useTransaction = true; // only set true if both calls succeed
        } catch (sessionErr) {
            // Standalone MongoDB — no replica set, cannot use transactions
            if (session) { try { session.endSession(); } catch (_) {} }
            session = null;
            useTransaction = false;
        }
    }

    try {
        const societyId = req.societyId;
        const userId = req.user.id;
        const {
            fromAccountId,
            toAccountId,
            amount,
            transferDate,
            referenceNumber,
            description
        } = req.body;

        if (!fromAccountId || !toAccountId || !amount || Number(amount) <= 0) {
            if (useTransaction && session) { await session.abortTransaction(); session.endSession(); }
            return sendError(res, 400, "From account, To account, and valid positive amount are required");
        }

        if (fromAccountId.toString() === toAccountId.toString()) {
            if (useTransaction && session) { await session.abortTransaction(); session.endSession(); }
            return sendError(res, 400, "Source and destination accounts cannot be the same");
        }

        const models = getModels();
        const options = (useTransaction && session) ? { session } : {};

        const [fromAccount, toAccount] = await Promise.all([
            models.FinancialAccount.findOne({ _id: fromAccountId, societyId }, null, options),
            models.FinancialAccount.findOne({ _id: toAccountId, societyId }, null, options)
        ]);

        if (!fromAccount || !toAccount) {
            if (useTransaction && session) { await session.abortTransaction(); session.endSession(); }
            return sendError(res, 404, "One or both financial accounts do not exist in this society");
        }

        if (fromAccount.status !== "ACTIVE" || toAccount.status !== "ACTIVE") {
            if (useTransaction && session) { await session.abortTransaction(); session.endSession(); }
            return sendError(res, 400, "Cannot transfer funds using inactive financial accounts");
        }

        // Determine Transfer Type
        let transferType = "BANK_TO_BANK";
        if (fromAccount.accountType === "CASH" && toAccount.accountType === "BANK") transferType = "CASH_TO_BANK";
        else if (fromAccount.accountType === "BANK" && toAccount.accountType === "CASH") transferType = "BANK_TO_CASH";
        else if (fromAccount.accountType === "CASH" && toAccount.accountType === "CASH") transferType = "CASH_TO_CASH";

        const transferNum = generateCode("TRF");
        const tDate = transferDate ? new Date(transferDate) : new Date();
        const transferAmount = Number(amount);

        // Update Account Balances
        fromAccount.currentBalance -= transferAmount;
        toAccount.currentBalance += transferAmount;

        await fromAccount.save(options);
        await toAccount.save(options);

        // Create Outbound Transaction on Source Account
        const outTx = new models.AccountTransaction({
            societyId,
            accountId: fromAccount._id,
            transactionNumber: generateCode("TX-OUT"),
            transactionType: "TRANSFER_OUT",
            direction: "DEBIT",
            transactionDate: tDate,
            amount: transferAmount,
            balanceAfterTransaction: fromAccount.currentBalance,
            paymentMethod: "INTERNAL_TRANSFER",
            referenceType: "TRANSFER",
            externalReference: referenceNumber || transferNum,
            description: `Transfer Out to ${toAccount.accountName}: ${description || ''}`,
            reconciliationStatus: "UNRECONCILED",
            createdBy: userId
        });
        await outTx.save(options);

        // Create Inbound Transaction on Destination Account
        const inTx = new models.AccountTransaction({
            societyId,
            accountId: toAccount._id,
            transactionNumber: generateCode("TX-IN"),
            transactionType: "TRANSFER_IN",
            direction: "CREDIT",
            transactionDate: tDate,
            amount: transferAmount,
            balanceAfterTransaction: toAccount.currentBalance,
            paymentMethod: "INTERNAL_TRANSFER",
            referenceType: "TRANSFER",
            externalReference: referenceNumber || transferNum,
            description: `Transfer In from ${fromAccount.accountName}: ${description || ''}`,
            reconciliationStatus: "UNRECONCILED",
            createdBy: userId
        });
        await inTx.save(options);

        // Save Header Transfer Record
        const transfer = new models.AccountTransfer({
            societyId,
            transferNumber: transferNum,
            fromAccountId: fromAccount._id,
            toAccountId: toAccount._id,
            amount: transferAmount,
            transferDate: tDate,
            referenceNumber: referenceNumber || transferNum,
            description: description || `Internal ${transferType} transfer`,
            transferType,
            outTransactionId: outTx._id,
            inTransactionId: inTx._id,
            createdBy: userId
        });
        await transfer.save(options);

        // Link transactions back to transfer model
        outTx.referenceId = transfer._id;
        outTx.referenceModel = "AccountTransfer";
        inTx.referenceId = transfer._id;
        inTx.referenceModel = "AccountTransfer";
        await outTx.save(options);
        await inTx.save(options);

        if (useTransaction && session) {
            await session.commitTransaction();
            session.endSession();
        }

        await createAuditLog({
            societyId,
            userId,
            action: "TRANSFER_CREATED",
            entityType: "AccountTransfer",
            entityId: transfer._id,
            newValue: { transferNum, amount: transferAmount, from: fromAccount.accountName, to: toAccount.accountName },
            req
        });

        return sendSuccess(res, 201, "Account transfer executed successfully", transfer);
    } catch (err) {
        // Standalone MongoDB: startTransaction() doesn't throw eagerly —
        // it only fails when an operation with { session } is actually executed.
        // Detect this error family and retry without sessions.
        const isTransactionUnsupported =
            err.code === 20 ||
            err.codeName === "IllegalOperation" ||
            (err.message && (
                err.message.includes("sharded cluster") ||
                err.message.includes("Transaction numbers") ||
                err.message.includes("replica set") ||
                err.message.toLowerCase().includes("transaction")
            ));

        if (useTransaction && session && isTransactionUnsupported) {
            try { await session.abortTransaction(); } catch (_) {}
            try { session.endSession(); } catch (_) {}
            // Retry WITHOUT sessions — pass _skipSession=true to prevent infinite recursion
            return createTransfer(req, res, next, true);
        }

        if (useTransaction && session) {
            try { await session.abortTransaction(); } catch (_) {}
            try { session.endSession(); } catch (_) {}
        }
        next(err);
    }
};

/**
 * Get account transfers history
 */
const getTransfers = async (req, res, next) => {
    try {
        const societyId = req.societyId;
        const models = getModels();
        const transfers = await models.AccountTransfer.find({ societyId })
            .sort({ transferDate: -1, createdAt: -1 })
            .populate("fromAccountId", "accountName accountType maskedAccountNumber")
            .populate("toAccountId", "accountName accountType maskedAccountNumber")
            .populate("createdBy", "name email")
            .lean();

        return sendSuccess(res, 200, "Transfers retrieved successfully", transfers);
    } catch (err) {
        next(err);
    }
};

// ── 5. Adjustments & Bank Charges ───────────────────────────────────────────

/**
 * Record a financial adjustment (Bank Charge, Interest, Shortage, Excess)
 */
const createAdjustment = async (req, res, next) => {
    try {
        const societyId = req.societyId;
        const userId = req.user.id;

        const {
            accountId,
            adjustmentDate,
            amount,
            adjustmentType,
            reason,
            description,
            referenceNumber
        } = req.body;

        if (!accountId || !amount || !adjustmentType || !reason) {
            return sendError(res, 400, "Account ID, amount, adjustment type, and reason are required");
        }

        const models = getModels();
        const account = await models.FinancialAccount.findOne({ _id: accountId, societyId });
        if (!account) return sendError(res, 404, "Financial account not found");

        const adjAmount = Number(amount);
        let direction = "DEBIT";

        // Bank charges/cash shortage reduces balance (DEBIT); Interest/Excess increases balance (CREDIT)
        if (["BANK_INTEREST", "CASH_EXCESS"].includes(adjustmentType)) {
            direction = "CREDIT";
            account.currentBalance += adjAmount;
        } else {
            direction = "DEBIT";
            account.currentBalance -= adjAmount;
        }

        await account.save();

        const adjNum = generateCode("ADJ");
        const aDate = adjustmentDate ? new Date(adjustmentDate) : new Date();

        // Create Account Transaction for Ledger
        const sysTx = new models.AccountTransaction({
            societyId,
            accountId: account._id,
            transactionNumber: generateCode("TX-ADJ"),
            transactionType: adjustmentType === "BANK_CHARGE" ? "BANK_CHARGE" : adjustmentType === "BANK_INTEREST" ? "BANK_INTEREST" : "ADJUSTMENT",
            direction,
            transactionDate: aDate,
            amount: adjAmount,
            balanceAfterTransaction: account.currentBalance,
            paymentMethod: "SYSTEM_ADJUSTMENT",
            referenceType: "ADJUSTMENT",
            externalReference: referenceNumber || adjNum,
            description: `[${adjustmentType}] ${description || reason}`,
            reconciliationStatus: "RECONCILED",
            createdBy: userId
        });
        await sysTx.save();

        // Save Adjustment Header
        const adjustment = new models.ReconciliationAdjustment({
            societyId,
            accountId: account._id,
            adjustmentNumber: adjNum,
            adjustmentDate: aDate,
            amount: adjAmount,
            adjustmentType,
            direction,
            description: description || reason,
            reason,
            referenceNumber,
            transactionId: sysTx._id,
            createdBy: userId
        });
        await adjustment.save();

        sysTx.referenceId = adjustment._id;
        sysTx.referenceModel = "ReconciliationAdjustment";
        await sysTx.save();

        await createAuditLog({
            societyId,
            userId,
            action: "ADJUSTMENT_CREATED",
            entityType: "ReconciliationAdjustment",
            entityId: adjustment._id,
            newValue: { adjNum, adjustmentType, amount: adjAmount, direction },
            req
        });

        return sendSuccess(res, 201, "Adjustment posted successfully", adjustment);
    } catch (err) {
        next(err);
    }
};

/**
 * Get adjustments history
 */
const getAdjustments = async (req, res, next) => {
    try {
        const societyId = req.societyId;
        const models = getModels();
        const adjustments = await models.ReconciliationAdjustment.find({ societyId })
            .sort({ adjustmentDate: -1, createdAt: -1 })
            .populate("accountId", "accountName accountType maskedAccountNumber")
            .populate("createdBy", "name email")
            .lean();

        return sendSuccess(res, 200, "Adjustments retrieved successfully", adjustments);
    } catch (err) {
        next(err);
    }
};

// ── 6. Cash Reconciliation & Denominations ──────────────────────────────────

/**
 * Save physical cash denomination count and record variance if any
 */
const recordCashCount = async (req, res, next) => {
    try {
        const societyId = req.societyId;
        const userId = req.user.id;

        const { accountId, denominations, notes } = req.body;

        if (!accountId || !denominations || !Array.isArray(denominations)) {
            return sendError(res, 400, "Cash Account ID and denominations array required");
        }

        const models = getModels();
        const account = await models.FinancialAccount.findOne({ _id: accountId, societyId });
        if (!account) return sendError(res, 404, "Cash account not found");
        if (account.accountType !== "CASH") {
            return sendError(res, 400, "Denomination counting is only for CASH accounts");
        }

        let actualCash = 0;
        const formattedDenoms = denominations.map(d => {
            const denom = Number(d.denomination);
            const qty = Number(d.quantity) || 0;
            const totalAmount = denom * qty;
            actualCash += totalAmount;
            return { denomination: denom, quantity: qty, totalAmount };
        });

        const expectedCash = account.currentBalance;
        const cashDifference = actualCash - expectedCash; // Positive = Excess, Negative = Shortage

        const cashCountDoc = new models.CashCount({
            societyId,
            accountId: account._id,
            countDate: new Date(),
            denominations: formattedDenoms,
            expectedCash,
            actualCash,
            cashDifference,
            notes,
            status: cashDifference === 0 ? "RECONCILED" : "COUNTED",
            createdBy: userId
        });
        await cashCountDoc.save();

        await createAuditLog({
            societyId,
            userId,
            action: "CASH_RECONCILIATION_COMPLETED",
            entityType: "CashCount",
            entityId: cashCountDoc._id,
            newValue: { expectedCash, actualCash, cashDifference },
            req
        });

        return sendSuccess(res, 201, "Cash count recorded successfully", cashCountDoc);
    } catch (err) {
        next(err);
    }
};

/**
 * Get Cash Count history
 */
const getCashCounts = async (req, res, next) => {
    try {
        const societyId = req.societyId;
        const models = getModels();
        const counts = await models.CashCount.find({ societyId })
            .sort({ countDate: -1, createdAt: -1 })
            .populate("accountId", "accountName accountType")
            .populate("createdBy", "name email")
            .lean();

        return sendSuccess(res, 200, "Cash counts retrieved successfully", counts);
    } catch (err) {
        next(err);
    }
};

// ── 7. Reconciliation Session Finalization & History ────────────────────────

/**
 * Finalize Reconciliation Session
 */
const finalizeReconciliation = async (req, res, next) => {
    try {
        const societyId = req.societyId;
        const userId = req.user.id;
        const {
            accountId,
            statementId,
            periodStart,
            periodEnd,
            openingBalance,
            statementClosingBalance,
            ledgerClosingBalance,
            difference
        } = req.body;

        if (!accountId || statementClosingBalance === undefined || ledgerClosingBalance === undefined) {
            return sendError(res, 400, "Account ID and statement/ledger balances are required");
        }

        const models = getModels();
        const account = await models.FinancialAccount.findOne({ _id: accountId, societyId });
        if (!account) return sendError(res, 404, "Financial account not found");

        const sessionNum = generateCode("REC");

        const session = new models.ReconciliationSession({
            societyId,
            accountId: account._id,
            statementId: statementId || null,
            reconciliationNumber: sessionNum,
            periodStart: new Date(periodStart),
            periodEnd: new Date(periodEnd),
            openingBalance: Number(openingBalance) || 0,
            statementClosingBalance: Number(statementClosingBalance),
            ledgerClosingBalance: Number(ledgerClosingBalance),
            difference: Number(difference) || 0,
            status: Number(difference) === 0 ? "FINALIZED" : "DIFFERENCE_PENDING",
            submittedBy: userId,
            approvedBy: userId,
            finalizedAt: Number(difference) === 0 ? new Date() : null
        });

        await session.save();

        if (Number(difference) === 0) {
            account.lastReconciledDate = new Date();
            await account.save();

            // Mark all matched transactions as fully RECONCILED
            await models.AccountTransaction.updateMany(
                { societyId, accountId: account._id, reconciliationStatus: { $in: ["MATCHED", "MANUAL_MATCH"] } },
                { $set: { reconciliationStatus: "RECONCILED", reconciliationId: session._id } }
            );
        }

        await createAuditLog({
            societyId,
            userId,
            action: "RECONCILIATION_FINALIZED",
            entityType: "ReconciliationSession",
            entityId: session._id,
            newValue: { sessionNum, difference: Number(difference), status: session.status },
            req
        });

        return sendSuccess(res, 201, "Reconciliation session created & finalized", session);
    } catch (err) {
        next(err);
    }
};

/**
 * Get Reconciliation History
 */
const getReconciliationHistory = async (req, res, next) => {
    try {
        const societyId = req.societyId;
        const models = getModels();
        const sessions = await models.ReconciliationSession.find({ societyId })
            .sort({ periodEnd: -1, createdAt: -1 })
            .populate("accountId", "accountName accountType maskedAccountNumber")
            .populate("submittedBy", "name email")
            .populate("approvedBy", "name email")
            .lean();

        return sendSuccess(res, 200, "Reconciliation history retrieved", sessions);
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getAccounts,
    createAccount,
    updateAccount,
    toggleAccountStatus,
    getAccountTransactions,
    importBankStatement,
    getStatementTransactions,
    manualMatchTransaction,
    createTransfer,
    getTransfers,
    createAdjustment,
    getAdjustments,
    recordCashCount,
    getCashCounts,
    finalizeReconciliation,
    getReconciliationHistory
};
