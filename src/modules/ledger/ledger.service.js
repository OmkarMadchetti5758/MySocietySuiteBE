"use strict";

const mongoose = require("mongoose");
const AppError = require("../../common/AppError");
const { getLedgerModels } = require("./ledger.model");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Derive financial year string (Apr-Mar Indian FY) from a date */
function getFinancialYear(date) {
    const d = new Date(date);
    const month = d.getMonth(); // 0-indexed; Apr=3
    const year = d.getFullYear();
    const fyStart = month >= 3 ? year : year - 1;
    return `${fyStart}-${String(fyStart + 1).slice(-2)}`;
}

/** Derive accounting period code (YYYY-MM) from a date */
function getAccountingPeriod(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Generate sequential journal number: JE-YYYY-NNNNN */
async function generateJournalNumber(societyId, db) {
    const { JournalEntry } = getLedgerModels(db);
    const year = new Date().getFullYear();
    const prefix = `JE-${year}-`;
    const last = await JournalEntry
        .findOne({ societyId, journalNumber: { $regex: `^${prefix}` } })
        .sort({ journalNumber: -1 })
        .lean();
    if (!last) return `${prefix}00001`;
    const seq = parseInt(last.journalNumber.replace(prefix, ""), 10);
    return `${prefix}${String(seq + 1).padStart(5, "0")}`;
}

/** Log a ledger audit action */
async function logLedgerAction({ db, societyId, userId, userRole, action, entity, entityId, oldValue, newValue, reason, ipAddress }) {
    try {
        const { LedgerAuditLog } = getLedgerModels(db);
        await LedgerAuditLog.create({
            societyId, userId, userRole, action,
            entity, entityId: entityId ? String(entityId) : null,
            oldValue: oldValue || null,
            newValue: newValue || null,
            reason: reason || null,
            ipAddress: ipAddress || null,
            timestamp: new Date(),
        });
    } catch (_) {
        // Audit log failures must never break the main operation
        console.warn("[LEDGER AUDIT] Failed to log action:", action);
    }
}

/** Assert that a date falls into an OPEN accounting period */
async function assertPeriodIsOpen(societyId, date, db) {
    const { AccountingPeriod } = getLedgerModels(db);
    const periodCode = getAccountingPeriod(date);
    const period = await AccountingPeriod.findOne({ societyId, periodCode }).lean();
    if (period && period.status === "CLOSED") {
        throw new AppError(
            `Accounting period ${period.periodName} is closed. Posting into a closed period is not allowed.`,
            422, "PERIOD_CLOSED"
        );
    }
    return periodCode;
}

/** Ensure or create the accounting period record for a given date */
async function ensureAccountingPeriod(societyId, date, db, createdBy) {
    const { AccountingPeriod } = getLedgerModels(db);
    const d = new Date(date);
    const periodCode = getAccountingPeriod(d);
    const financialYear = getFinancialYear(d);
    const year = d.getFullYear();
    const month = d.getMonth(); // 0-indexed

    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
    const periodNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];
    const periodName = `${periodNames[month]} ${year}`;

    await AccountingPeriod.findOneAndUpdate(
        { societyId, periodCode },
        {
            $setOnInsert: { societyId, financialYear, periodName, periodCode, startDate: start, endDate: end, status: "OPEN", createdBy },
        },
        { upsert: true, new: true }
    );
    return periodCode;
}

// ─── Chart of Accounts ───────────────────────────────────────────────────────

class LedgerService {

    /** Seed default chart of accounts for a new society */
    static async seedDefaultChartOfAccounts(societyId, userId, db) {
        const { ChartOfAccount } = getLedgerModels(db);
        const existing = await ChartOfAccount.countDocuments({ societyId }).lean();
        if (existing > 0) return { alreadyExists: true };

        const sid = new mongoose.Types.ObjectId(societyId);
        const uid = new mongoose.Types.ObjectId(userId);

        const defaults = [
            // ASSETS
            { accountCode: "1000", accountName: "Assets",                 accountType: "ASSET",     normalBalanceType: "DEBIT",  isSystemAccount: true,  parentAccountId: null },
            { accountCode: "1010", accountName: "Bank Accounts",          accountType: "ASSET",     normalBalanceType: "DEBIT",  isSystemAccount: true,  parentAccountCode: "1000" },
            { accountCode: "1011", accountName: "Cash Account",           accountType: "ASSET",     normalBalanceType: "DEBIT",  isSystemAccount: true,  parentAccountCode: "1000" },
            { accountCode: "1020", accountName: "Receivables",            accountType: "ASSET",     normalBalanceType: "DEBIT",  isSystemAccount: true,  parentAccountCode: "1000" },
            { accountCode: "1021", accountName: "Resident Receivables",   accountType: "ASSET",     normalBalanceType: "DEBIT",  isSystemAccount: true,  parentAccountCode: "1020" },
            { accountCode: "1030", accountName: "Other Assets",           accountType: "ASSET",     normalBalanceType: "DEBIT",  isSystemAccount: false, parentAccountCode: "1000" },

            // LIABILITIES
            { accountCode: "2000", accountName: "Liabilities",            accountType: "LIABILITY",  normalBalanceType: "CREDIT", isSystemAccount: true,  parentAccountId: null },
            { accountCode: "2010", accountName: "Resident Advance Liability", accountType: "LIABILITY", normalBalanceType: "CREDIT", isSystemAccount: true, parentAccountCode: "2000" },
            { accountCode: "2020", accountName: "Security Deposit Liability", accountType: "LIABILITY", normalBalanceType: "CREDIT", isSystemAccount: true, parentAccountCode: "2000" },
            { accountCode: "2030", accountName: "Payables",               accountType: "LIABILITY",  normalBalanceType: "CREDIT", isSystemAccount: true,  parentAccountCode: "2000" },
            { accountCode: "2040", accountName: "Payment Gateway Clearing",accountType: "LIABILITY",  normalBalanceType: "CREDIT", isSystemAccount: true,  parentAccountCode: "2000" },
            { accountCode: "2050", accountName: "Other Liabilities",      accountType: "LIABILITY",  normalBalanceType: "CREDIT", isSystemAccount: false, parentAccountCode: "2000" },

            // EQUITY
            { accountCode: "3000", accountName: "Equity / Reserve Fund",  accountType: "EQUITY",    normalBalanceType: "CREDIT", isSystemAccount: true,  parentAccountId: null },
            { accountCode: "3010", accountName: "General Reserve Fund",   accountType: "EQUITY",    normalBalanceType: "CREDIT", isSystemAccount: true,  parentAccountCode: "3000" },
            { accountCode: "3020", accountName: "Sinking Fund",           accountType: "EQUITY",    normalBalanceType: "CREDIT", isSystemAccount: false, parentAccountCode: "3000" },

            // INCOME
            { accountCode: "4000", accountName: "Income",                 accountType: "INCOME",    normalBalanceType: "CREDIT", isSystemAccount: true,  parentAccountId: null },
            { accountCode: "4010", accountName: "Maintenance Income",     accountType: "INCOME",    normalBalanceType: "CREDIT", isSystemAccount: true,  parentAccountCode: "4000" },
            { accountCode: "4020", accountName: "Parking Income",         accountType: "INCOME",    normalBalanceType: "CREDIT", isSystemAccount: false, parentAccountCode: "4000" },
            { accountCode: "4030", accountName: "Amenity Income",         accountType: "INCOME",    normalBalanceType: "CREDIT", isSystemAccount: false, parentAccountCode: "4000" },
            { accountCode: "4040", accountName: "Fine Income",            accountType: "INCOME",    normalBalanceType: "CREDIT", isSystemAccount: true,  parentAccountCode: "4000" },
            { accountCode: "4050", accountName: "Interest Income",        accountType: "INCOME",    normalBalanceType: "CREDIT", isSystemAccount: true,  parentAccountCode: "4000" },
            { accountCode: "4060", accountName: "Other Income",           accountType: "INCOME",    normalBalanceType: "CREDIT", isSystemAccount: false, parentAccountCode: "4000" },

            // EXPENSES
            { accountCode: "5000", accountName: "Expenses",               accountType: "EXPENSE",   normalBalanceType: "DEBIT",  isSystemAccount: true,  parentAccountId: null },
            { accountCode: "5010", accountName: "Electricity Expense",    accountType: "EXPENSE",   normalBalanceType: "DEBIT",  isSystemAccount: false, parentAccountCode: "5000" },
            { accountCode: "5020", accountName: "Security Services",      accountType: "EXPENSE",   normalBalanceType: "DEBIT",  isSystemAccount: false, parentAccountCode: "5000" },
            { accountCode: "5030", accountName: "Cleaning & Housekeeping",accountType: "EXPENSE",   normalBalanceType: "DEBIT",  isSystemAccount: false, parentAccountCode: "5000" },
            { accountCode: "5040", accountName: "Repairs & Maintenance",  accountType: "EXPENSE",   normalBalanceType: "DEBIT",  isSystemAccount: false, parentAccountCode: "5000" },
            { accountCode: "5050", accountName: "Administrative Expenses",accountType: "EXPENSE",   normalBalanceType: "DEBIT",  isSystemAccount: false, parentAccountCode: "5000" },
            { accountCode: "5060", accountName: "Other Expenses",         accountType: "EXPENSE",   normalBalanceType: "DEBIT",  isSystemAccount: false, parentAccountCode: "5000" },
        ];

        // First pass: create all root accounts
        const createdMap = {};
        const rootAccounts = defaults.filter(a => !a.parentAccountCode);
        for (const acc of rootAccounts) {
            const created = await ChartOfAccount.create({
                societyId: sid, createdBy: uid, updatedBy: uid,
                accountCode: acc.accountCode,
                accountName: acc.accountName,
                accountType: acc.accountType,
                normalBalanceType: acc.normalBalanceType,
                isSystemAccount: acc.isSystemAccount,
                description: `Default ${acc.accountName} account`,
                status: "ACTIVE",
                parentAccountId: null,
            });
            createdMap[acc.accountCode] = created._id;
        }

        // Second pass: create child accounts
        const childAccounts = defaults.filter(a => a.parentAccountCode);
        for (const acc of childAccounts) {
            const created = await ChartOfAccount.create({
                societyId: sid, createdBy: uid, updatedBy: uid,
                accountCode: acc.accountCode,
                accountName: acc.accountName,
                accountType: acc.accountType,
                normalBalanceType: acc.normalBalanceType,
                isSystemAccount: acc.isSystemAccount,
                description: `Default ${acc.accountName} account`,
                status: "ACTIVE",
                parentAccountId: createdMap[acc.parentAccountCode] || null,
            });
            createdMap[acc.accountCode] = created._id;
        }

        await logLedgerAction({
            db, societyId, userId, userRole: "system",
            action: "COA_SEEDED", entity: "ChartOfAccount",
            newValue: { count: defaults.length },
        });

        return { seeded: defaults.length, accountMap: createdMap };
    }

    static async syncFinancialAccounts(societyId, db) {
        const { ChartOfAccount } = getLedgerModels(db);
        const { getReconciliationModels } = require("../reconciliation/reconciliation.model");
        const { FinancialAccount } = getReconciliationModels(db);
        
        const finAccounts = await FinancialAccount.find({ societyId }).lean();
        if (!finAccounts.length) return;
        
        // Ensure parent 1000 Assets exists
        let rootAsset = await ChartOfAccount.findOne({ societyId, accountCode: "1000" }).lean();
        if (!rootAsset) {
            rootAsset = await ChartOfAccount.create({
                societyId, accountCode: "1000", accountName: "Assets", accountType: "ASSET",
                normalBalanceType: "DEBIT", isSystemAccount: true, createdBy: finAccounts[0].createdBy
            });
        }
        
        for (const f of finAccounts) {
            const existingCoa = await ChartOfAccount.findOne({ societyId, financialAccountId: f._id }).lean();
            if (!existingCoa) {
                const parentCode = f.accountType === "BANK" ? "1010" : "1011";
                const parentName = f.accountType === "BANK" ? "Bank Accounts" : "Cash Account";
                
                let parent = await ChartOfAccount.findOne({ societyId, accountCode: parentCode }).lean();
                if (!parent) {
                    parent = await ChartOfAccount.create({
                        societyId, accountCode: parentCode, accountName: parentName, accountType: "ASSET",
                        normalBalanceType: "DEBIT", isSystemAccount: true, parentAccountId: rootAsset._id, createdBy: f.createdBy
                    });
                }
                
                const children = await ChartOfAccount.find({ societyId, parentAccountId: parent._id }).sort({ accountCode: -1 }).lean();
                let newCode = parentCode + "1";
                if (children.length > 0) {
                    const lastCode = parseInt(children[0].accountCode, 10);
                    if (!isNaN(lastCode)) {
                        newCode = String(lastCode + 1);
                    } else {
                        newCode = parentCode + String(children.length + 1);
                    }
                }
                
                await ChartOfAccount.create({
                    societyId: f.societyId,
                    accountCode: newCode,
                    accountName: f.accountName,
                    accountType: "ASSET",
                    normalBalanceType: "DEBIT",
                    isSystemAccount: false,
                    description: `Auto-synced ${f.accountType.toLowerCase()} account`,
                    status: f.status || "ACTIVE",
                    parentAccountId: parent._id,
                    financialAccountId: f._id,
                    createdBy: f.createdBy,
                    updatedBy: f.createdBy,
                });
            } else if (existingCoa.status !== f.status || existingCoa.accountName !== f.accountName) {
                await ChartOfAccount.updateOne(
                    { _id: existingCoa._id }, 
                    { $set: { status: f.status, accountName: f.accountName } }
                );
            }
        }
    }

    static async getChartOfAccounts(societyId, db, filters = {}) {
        await this.syncFinancialAccounts(societyId, db);
        const { ChartOfAccount } = getLedgerModels(db);
        const query = { societyId };
        if (filters.status) query.status = filters.status;
        if (filters.accountType) query.accountType = filters.accountType;
        if (filters.search) {
            query.$or = [
                { accountName: { $regex: filters.search, $options: "i" } },
                { accountCode: { $regex: filters.search, $options: "i" } },
            ];
        }
        return ChartOfAccount.find(query)
            .populate("parentAccountId", "accountCode accountName")
            .sort({ accountCode: 1 })
            .lean();
    }

    static async createAccount(societyId, userId, data, db) {
        const { ChartOfAccount } = getLedgerModels(db);
        const { accountCode, accountName, accountType, parentAccountId, description, openingBalance, normalBalanceType } = data;

        if (!accountCode || !accountName || !accountType) {
            throw new AppError("accountCode, accountName, and accountType are required.", 400);
        }

        const existing = await ChartOfAccount.findOne({ societyId, accountCode: accountCode.toUpperCase() }).lean();
        if (existing) throw new AppError(`Account code '${accountCode}' already exists in this society.`, 409);

        if (parentAccountId) {
            const parent = await ChartOfAccount.findOne({ _id: parentAccountId, societyId }).lean();
            if (!parent) throw new AppError("Parent account not found or belongs to another society.", 404);
        }

        const account = await ChartOfAccount.create({
            societyId, createdBy: userId, updatedBy: userId,
            accountCode: accountCode.toUpperCase().trim(),
            accountName: accountName.trim(),
            accountType,
            parentAccountId: parentAccountId || null,
            description: description || "",
            openingBalance: Number(openingBalance) || 0,
            currentBalance: Number(openingBalance) || 0,
            normalBalanceType: normalBalanceType || (["ASSET", "EXPENSE"].includes(accountType) ? "DEBIT" : "CREDIT"),
            status: "ACTIVE",
        });

        await logLedgerAction({
            db, societyId, userId, userRole: "accountant",
            action: "ACCOUNT_CREATED", entity: "ChartOfAccount", entityId: account._id,
            newValue: { accountCode, accountName, accountType },
        });

        return account;
    }

    static async deactivateAccount(societyId, userId, accountId, db) {
        const { ChartOfAccount, JournalEntryLine } = getLedgerModels(db);
        const account = await ChartOfAccount.findOne({ _id: accountId, societyId }).lean();
        if (!account) throw new AppError("Account not found.", 404);
        if (account.isSystemAccount) throw new AppError("System accounts cannot be deactivated.", 403);

        const hasTransactions = await JournalEntryLine.exists({ accountId, societyId });
        if (hasTransactions && account.status === "ACTIVE") {
            // Allow deactivation but not deletion
        }

        const updated = await ChartOfAccount.findByIdAndUpdate(
            accountId,
            { status: "INACTIVE", updatedBy: userId },
            { new: true }
        );

        await logLedgerAction({
            db, societyId, userId, userRole: "accountant",
            action: "ACCOUNT_DEACTIVATED", entity: "ChartOfAccount", entityId: accountId,
            oldValue: { status: "ACTIVE" }, newValue: { status: "INACTIVE" },
        });

        return updated;
    }

    // ─── Journal Entry Engine ──────────────────────────────────────────────────

    /**
     * Core method: Post a validated journal entry to the ledger.
     * Enforces: double-entry, period open, idempotency, society isolation.
     */
    static async postJournalEntry({ societyId, userId, userRole, description, transactionDate,
        referenceType, referenceId, referenceNumber, lines, idempotencyKey,
        isAutomatic = false, residentId = null, flatId = null, notes = null, db, session = null
    }) {
        const { ChartOfAccount, JournalEntry, JournalEntryLine } = getLedgerModels(db);

        // 1. Idempotency check
        if (idempotencyKey) {
            const existing = await JournalEntry.findOne({ societyId, idempotencyKey }).lean();
            if (existing) {
                return { journalEntry: existing, duplicate: true };
            }
        }

        // 2. Validate lines (at least 2, debit === credit)
        if (!Array.isArray(lines) || lines.length < 2) {
            throw new AppError("A journal entry requires at least 2 lines.", 400);
        }
        let totalDebit = 0, totalCredit = 0;
        for (const line of lines) {
            if ((line.debit || 0) < 0 || (line.credit || 0) < 0) throw new AppError("Debit and credit amounts must be non-negative.", 400);
            if ((line.debit || 0) === 0 && (line.credit || 0) === 0) throw new AppError("A journal line cannot have both debit and credit as zero.", 400);
            totalDebit  += Number(line.debit || 0);
            totalCredit += Number(line.credit || 0);
        }
        const diff = Math.abs(totalDebit - totalCredit);
        if (diff > 0.01) {
            throw new AppError(`Journal entry is unbalanced. Total Debit: ₹${totalDebit.toFixed(2)}, Total Credit: ₹${totalCredit.toFixed(2)}. Difference: ₹${diff.toFixed(2)}.`, 422, "UNBALANCED_JOURNAL");
        }

        // 3. Validate all accounts belong to this society
        const accountIds = lines.map(l => l.accountId);
        const accounts = await ChartOfAccount.find({ _id: { $in: accountIds }, societyId, status: "ACTIVE" }).lean();
        if (accounts.length !== accountIds.length) {
            throw new AppError("One or more accounts are invalid, inactive, or belong to another society.", 400, "INVALID_ACCOUNT");
        }

        // 4. Ensure period is OPEN
        const txDate = new Date(transactionDate || Date.now());
        await assertPeriodIsOpen(societyId, txDate, db);
        const periodCode = await ensureAccountingPeriod(societyId, txDate, db, userId);
        const financialYear = getFinancialYear(txDate);

        // 5. Generate journal number
        const journalNumber = await generateJournalNumber(societyId, db);

        // 6. Create JournalEntry (POSTED for automatic, DRAFT for manual)
        const status = isAutomatic ? "POSTED" : "DRAFT";
        const opts = session ? { session } : {};

        const journalEntry = await JournalEntry.create([{
            societyId, journalNumber, transactionDate: txDate,
            postingDate: isAutomatic ? new Date() : null,
            financialYear, accountingPeriod: periodCode,
            description, referenceType: referenceType || "MANUAL",
            referenceId: referenceId ? String(referenceId) : null,
            referenceNumber: referenceNumber || null,
            idempotencyKey: idempotencyKey || null,
            status, totalDebit, totalCredit,
            isAutomatic, residentId: residentId || null, flatId: flatId || null,
            createdBy: userId,
            postedBy:  isAutomatic ? userId : null,
            postedAt:  isAutomatic ? new Date() : null,
            notes,
        }], opts);

        const je = journalEntry[0];

        // 7. Create JournalEntryLines
        const lineDocuments = lines.map(line => ({
            societyId,
            journalId: je._id,
            accountId: line.accountId,
            debit: Number(line.debit || 0),
            credit: Number(line.credit || 0),
            description: line.description || "",
            residentId: line.residentId || residentId || null,
            flatId: line.flatId || flatId || null,
            reconciliationStatus: "UNRECONCILED",
        }));
        await JournalEntryLine.insertMany(lineDocuments, opts);

        // 8. Update account balances for POSTED entries
        if (status === "POSTED") {
            await LedgerService._updateAccountBalances(societyId, lineDocuments, accounts, db, opts);
        }

        await logLedgerAction({
            db, societyId, userId, userRole: userRole || "system",
            action: "JV_CREATED",
            entity: "JournalEntry", entityId: je._id,
            newValue: { journalNumber, status, totalDebit, totalCredit, referenceType },
        });

        return { journalEntry: je, duplicate: false };
    }

    /** Update cached account balances after a posting */
    static async _updateAccountBalances(societyId, lines, accounts, db, opts = {}) {
        const { ChartOfAccount } = getLedgerModels(db);
        const accountMap = {};
        for (const acc of accounts) accountMap[String(acc._id)] = acc;

        for (const line of lines) {
            const acc = accountMap[String(line.accountId)];
            if (!acc) continue;
            // DEBIT increases DEBIT-normal accounts (ASSET, EXPENSE), decreases CREDIT-normal accounts
            const isDebitNormal = acc.normalBalanceType === "DEBIT";
            const balanceDelta = isDebitNormal
                ? (line.debit - line.credit)
                : (line.credit - line.debit);

            await ChartOfAccount.findByIdAndUpdate(
                line.accountId,
                { $inc: { currentBalance: balanceDelta } },
                opts
            );
        }
    }

    /** Submit a DRAFT journal entry for approval */
    static async submitJournalEntry(societyId, userId, journalId, db) {
        const { JournalEntry } = getLedgerModels(db);
        const je = await JournalEntry.findOne({ _id: journalId, societyId }).lean();
        if (!je) throw new AppError("Journal entry not found.", 404);
        if (je.status !== "DRAFT") throw new AppError(`Cannot submit a journal entry with status: ${je.status}.`, 422);

        const updated = await JournalEntry.findByIdAndUpdate(journalId, {
            status: "PENDING_APPROVAL", submittedBy: userId,
        }, { new: true });

        await logLedgerAction({ db, societyId, userId, userRole: "accountant",
            action: "JV_SUBMITTED", entity: "JournalEntry", entityId: journalId,
            oldValue: { status: "DRAFT" }, newValue: { status: "PENDING_APPROVAL" },
        });
        return updated;
    }

    /** Approve a PENDING_APPROVAL journal entry */
    static async approveJournalEntry(societyId, userId, journalId, db) {
        const { JournalEntry } = getLedgerModels(db);
        const je = await JournalEntry.findOne({ _id: journalId, societyId }).lean();
        if (!je) throw new AppError("Journal entry not found.", 404);
        if (je.status !== "PENDING_APPROVAL") throw new AppError(`Cannot approve a journal entry with status: ${je.status}.`, 422);

        const updated = await JournalEntry.findByIdAndUpdate(journalId, {
            status: "APPROVED", approvedBy: userId, approvedAt: new Date(),
        }, { new: true });

        await logLedgerAction({ db, societyId, userId, userRole: "admin",
            action: "JV_APPROVED", entity: "JournalEntry", entityId: journalId,
            oldValue: { status: "PENDING_APPROVAL" }, newValue: { status: "APPROVED" },
        });
        return updated;
    }

    /** Post an APPROVED or DRAFT journal entry to the ledger */
    static async postManualJournalEntry(societyId, userId, journalId, db) {
        const { JournalEntry, JournalEntryLine, ChartOfAccount } = getLedgerModels(db);
        const je = await JournalEntry.findOne({ _id: journalId, societyId }).lean();
        if (!je) throw new AppError("Journal entry not found.", 404);
        if (!["APPROVED", "DRAFT"].includes(je.status)) throw new AppError(`Cannot post a journal entry with status: ${je.status}.`, 422);
        if (je.isAutomatic) throw new AppError("Automatic journal entries cannot be manually posted.", 403);

        // Verify period still open
        await assertPeriodIsOpen(societyId, je.transactionDate, db);

        const session = await db.startSession();
        try {
            session.startTransaction();
            const updated = await JournalEntry.findByIdAndUpdate(journalId, {
                status: "POSTED", postedBy: userId, postedAt: new Date(),
                postingDate: new Date(),
            }, { new: true, session });

            // Apply balance updates
            const lines = await JournalEntryLine.find({ journalId, societyId }).lean();
            const accountIds = lines.map(l => l.accountId);
            const accounts = await ChartOfAccount.find({ _id: { $in: accountIds }, societyId }).lean();
            await LedgerService._updateAccountBalances(societyId, lines, accounts, db, { session });

            await session.commitTransaction();

            await logLedgerAction({ db, societyId, userId, userRole: "accountant",
                action: "JV_POSTED", entity: "JournalEntry", entityId: journalId,
                oldValue: { status: je.status }, newValue: { status: "POSTED" },
            });
            return updated;
        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            session.endSession();
        }
    }

    /** Reject a PENDING_APPROVAL journal entry */
    static async rejectJournalEntry(societyId, userId, journalId, reason, db) {
        const { JournalEntry } = getLedgerModels(db);
        const je = await JournalEntry.findOne({ _id: journalId, societyId }).lean();
        if (!je) throw new AppError("Journal entry not found.", 404);
        if (je.status !== "PENDING_APPROVAL") throw new AppError(`Cannot reject a journal entry with status: ${je.status}.`, 422);
        if (!reason) throw new AppError("Rejection reason is required.", 400);

        const updated = await JournalEntry.findByIdAndUpdate(journalId, {
            status: "REJECTED", rejectedBy: userId, rejectionReason: reason,
        }, { new: true });

        await logLedgerAction({ db, societyId, userId, userRole: "admin",
            action: "JV_REJECTED", entity: "JournalEntry", entityId: journalId,
            reason, oldValue: { status: "PENDING_APPROVAL" }, newValue: { status: "REJECTED" },
        });
        return updated;
    }

    /** Reverse a POSTED journal entry — creates a new mirror-image entry */
    static async reverseJournalEntry(societyId, userId, userRole, journalId, reason, db) {
        const { JournalEntry, JournalEntryLine, ChartOfAccount } = getLedgerModels(db);
        if (!reason) throw new AppError("Reversal reason is required.", 400);

        const original = await JournalEntry.findOne({ _id: journalId, societyId }).lean();
        if (!original) throw new AppError("Journal entry not found.", 404);
        if (original.status !== "POSTED") throw new AppError("Only POSTED journal entries can be reversed.", 422);
        if (original.reversedByJournalId) throw new AppError("This journal entry has already been reversed.", 409);

        // Verify period open
        await assertPeriodIsOpen(societyId, new Date(), db);

        const originalLines = await JournalEntryLine.find({ journalId, societyId }).lean();

        const session = await db.startSession();
        try {
            session.startTransaction();

            // Mark original as reversed
            await JournalEntry.findByIdAndUpdate(journalId, { status: "REVERSED" }, { session });

            // Create reversal entry (flip debit/credit)
            const reversalLines = originalLines.map(l => ({
                accountId: l.accountId,
                debit: l.credit,   // flip
                credit: l.debit,   // flip
                description: `Reversal: ${l.description || ""}`,
                residentId: l.residentId,
                flatId: l.flatId,
            }));

            const txDate = new Date();
            const periodCode = await ensureAccountingPeriod(societyId, txDate, db, userId);
            const journalNumber = await generateJournalNumber(societyId, db);

            const [reversalJE] = await JournalEntry.create([{
                societyId, journalNumber,
                transactionDate: txDate, postingDate: txDate,
                financialYear: getFinancialYear(txDate),
                accountingPeriod: periodCode,
                description: `Reversal of ${original.journalNumber}: ${reason}`,
                referenceType: "REVERSAL",
                referenceId: String(original._id),
                referenceNumber: original.journalNumber,
                status: "POSTED", isAutomatic: true, isReversal: true,
                reversalOfJournalId: original._id,
                reversalReason: reason,
                totalDebit: original.totalCredit,
                totalCredit: original.totalDebit,
                residentId: original.residentId,
                flatId: original.flatId,
                createdBy: userId, postedBy: userId, postedAt: txDate,
            }], { session });

            const lineDocuments = reversalLines.map(line => ({
                societyId, journalId: reversalJE._id,
                accountId: line.accountId,
                debit: Number(line.debit || 0), credit: Number(line.credit || 0),
                description: line.description, residentId: line.residentId, flatId: line.flatId,
                reconciliationStatus: "UNRECONCILED",
            }));
            await JournalEntryLine.insertMany(lineDocuments, { session });

            // Update original with reversal link
            await JournalEntry.findByIdAndUpdate(journalId, { reversedByJournalId: reversalJE._id }, { session });

            // Update account balances for reversal
            const accountIds = lineDocuments.map(l => l.accountId);
            const accounts = await ChartOfAccount.find({ _id: { $in: accountIds }, societyId }, null, { session }).lean();
            await LedgerService._updateAccountBalances(societyId, lineDocuments, accounts, db, { session });

            await session.commitTransaction();

            await logLedgerAction({ db, societyId, userId, userRole,
                action: "JV_REVERSED", entity: "JournalEntry", entityId: journalId,
                reason, newValue: { reversalJournalId: reversalJE._id, reversalJournalNumber: journalNumber },
            });

            return reversalJE;
        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            session.endSession();
        }
    }

    // ─── Query & Reporting ─────────────────────────────────────────────────────

    static async getGeneralLedger(societyId, db, filters = {}) {
        const { JournalEntry, JournalEntryLine } = getLedgerModels(db);
        const { page = 1, limit = 25, startDate, endDate, accountId, referenceType, reconciliationStatus, status, search } = filters;

        const skip = (parseInt(page) - 1) * Math.min(parseInt(limit), 100);
        const lim = Math.min(parseInt(limit) || 25, 100);

        // Build JournalEntry filter
        const jeFilter = { societyId };
        if (status && status !== "ALL") jeFilter.status = status;
        if (startDate || endDate) {
            jeFilter.transactionDate = {};
            if (startDate) jeFilter.transactionDate.$gte = new Date(startDate);
            if (endDate) jeFilter.transactionDate.$lte = new Date(endDate);
        }
        if (referenceType) jeFilter.referenceType = referenceType;
        if (search) {
            jeFilter.$or = [
                { journalNumber: { $regex: search, $options: "i" } },
                { description: { $regex: search, $options: "i" } },
                { referenceNumber: { $regex: search, $options: "i" } },
            ];
        }

        // If accountId filter, find matching journal IDs first
        let journalIdFilter = {};
        if (accountId) {
            const jids = await JournalEntryLine.distinct("journalId", { societyId, accountId });
            journalIdFilter = { _id: { $in: jids } };
        }
        if (reconciliationStatus) {
            const jids2 = await JournalEntryLine.distinct("journalId", { societyId, reconciliationStatus });
            const existing = journalIdFilter._id?.$in;
            journalIdFilter._id = { $in: existing ? jids2.filter(id => existing.some(e => String(e) === String(id))) : jids2 };
        }

        const finalFilter = { ...jeFilter, ...journalIdFilter };
        const total = await JournalEntry.countDocuments(finalFilter);
        const entries = await JournalEntry.find(finalFilter)
            .sort({ transactionDate: -1, createdAt: -1 })
            .skip(skip).limit(lim)
            .populate("createdBy", "name email")
            .populate("approvedBy", "name email")
            .populate("postedBy", "name email")
            .lean();

        // Attach lines
        const journalIds = entries.map(e => e._id);
        const allLines = await JournalEntryLine.find({ journalId: { $in: journalIds }, societyId })
            .populate("accountId", "accountCode accountName accountType normalBalanceType")
            .lean();

        const linesByJournal = {};
        for (const line of allLines) {
            const key = String(line.journalId);
            if (!linesByJournal[key]) linesByJournal[key] = [];
            linesByJournal[key].push(line);
        }

        const result = entries.map(e => ({
            ...e,
            lines: linesByJournal[String(e._id)] || [],
        }));

        return {
            entries: result,
            meta: { total, page: parseInt(page), limit: lim, totalPages: Math.ceil(total / lim) },
        };
    }

    static async getGeneralLedgerLines(societyId, db, filters = {}) {
        const { JournalEntry, JournalEntryLine } = getLedgerModels(db);
        const { page = 1, limit = 50, startDate, endDate, accountId, search } = filters;

        const skip = (parseInt(page) - 1) * Math.min(parseInt(limit), 100);
        const lim = Math.min(parseInt(limit) || 50, 100);

        // First find POSTED journal entries
        const jeFilter = { societyId, status: "POSTED" };
        if (startDate || endDate) {
            jeFilter.transactionDate = {};
            if (startDate) jeFilter.transactionDate.$gte = new Date(startDate);
            if (endDate) jeFilter.transactionDate.$lte = new Date(endDate);
        }
        
        let validJournalIds = [];
        if (search) {
            jeFilter.$or = [
                { journalNumber: { $regex: search, $options: "i" } },
                { description: { $regex: search, $options: "i" } },
                { referenceNumber: { $regex: search, $options: "i" } },
            ];
            const matchingJournals = await JournalEntry.find(jeFilter).select('_id').lean();
            validJournalIds = matchingJournals.map(j => j._id);
        }

        const lineFilter = { societyId };
        if (accountId) lineFilter.accountId = accountId;
        if (search) {
             lineFilter.$or = [
                 { description: { $regex: search, $options: "i" } },
                 { journalId: { $in: validJournalIds } }
             ];
        } else {
             // If no search, we still must filter by the date range of journals
             const journalsInDateRange = await JournalEntry.find(jeFilter).select('_id').lean();
             lineFilter.journalId = { $in: journalsInDateRange.map(j => j._id) };
        }

        const total = await JournalEntryLine.countDocuments(lineFilter);
        const lines = await JournalEntryLine.find(lineFilter)
            .sort({ createdAt: -1 })
            .skip(skip).limit(lim)
            .populate("accountId", "accountCode accountName")
            .populate("journalId", "journalNumber isReversal transactionDate postedAt")
            .lean();

        // Sort lines correctly by journal transaction date then created At
        lines.sort((a, b) => {
            const dateA = new Date(a.journalId?.postedAt || a.createdAt);
            const dateB = new Date(b.journalId?.postedAt || b.createdAt);
            return dateB - dateA;
        });

        return {
            entries: lines,
            meta: { total, page: parseInt(page), limit: lim, totalPages: Math.ceil(total / lim) },
        };
    }

    static async getAccountStatement(societyId, accountId, db, filters = {}) {
        const { ChartOfAccount, JournalEntry, JournalEntryLine } = getLedgerModels(db);
        const { startDate, endDate, financialYear } = filters;

        const account = await ChartOfAccount.findOne({ _id: accountId, societyId }).lean();
        if (!account) throw new AppError("Account not found.", 404);

        const dateFilter = {};
        if (startDate) dateFilter.$gte = new Date(startDate);
        if (endDate) dateFilter.$lte = new Date(endDate);

        // Get POSTED journal entries for this account
        const jeFilter = { societyId, status: "POSTED" };
        if (financialYear) jeFilter.financialYear = financialYear;
        if (startDate || endDate) jeFilter.transactionDate = dateFilter;

        const journalIds = await JournalEntry.distinct("_id", jeFilter);
        const lines = await JournalEntryLine.find({
            societyId, accountId, journalId: { $in: journalIds },
        })
        .sort({ createdAt: 1 })
        .populate({ path: "journalId", select: "journalNumber transactionDate description referenceType referenceNumber" })
        .lean();

        let runningBalance = account.openingBalance || 0;
        const isDebitNormal = account.normalBalanceType === "DEBIT";

        const transactions = lines.map(line => {
            const delta = isDebitNormal ? (line.debit - line.credit) : (line.credit - line.debit);
            runningBalance += delta;
            return {
                date: line.journalId?.transactionDate,
                journalNumber: line.journalId?.journalNumber,
                description: line.journalId?.description || line.description,
                referenceType: line.journalId?.referenceType,
                referenceNumber: line.journalId?.referenceNumber,
                debit: line.debit,
                credit: line.credit,
                runningBalance,
                reconciliationStatus: line.reconciliationStatus,
            };
        });

        return {
            account,
            openingBalance: account.openingBalance || 0,
            transactions,
            closingBalance: runningBalance,
        };
    }

    static async getResidentLedger(societyId, residentId, db, filters = {}) {
        const { JournalEntry, JournalEntryLine, ChartOfAccount } = getLedgerModels(db);
        const { startDate, endDate, financialYear, page = 1, limit = 50 } = filters;

        const skip = (parseInt(page) - 1) * Math.min(parseInt(limit), 100);
        const lim = Math.min(parseInt(limit) || 50, 100);

        const jeFilter = { societyId, status: "POSTED", residentId };
        if (financialYear) jeFilter.financialYear = financialYear;
        if (startDate || endDate) {
            jeFilter.transactionDate = {};
            if (startDate) jeFilter.transactionDate.$gte = new Date(startDate);
            if (endDate) jeFilter.transactionDate.$lte = new Date(endDate);
        }

        const total = await JournalEntry.countDocuments(jeFilter);
        const entries = await JournalEntry.find(jeFilter)
            .sort({ transactionDate: -1 })
            .skip(skip).limit(lim)
            .lean();

        const journalIds = entries.map(e => e._id);
        const allLines = await JournalEntryLine.find({ journalId: { $in: journalIds }, societyId })
            .populate("accountId", "accountCode accountName accountType")
            .lean();

        const linesByJournal = {};
        for (const line of allLines) {
            const key = String(line.journalId);
            if (!linesByJournal[key]) linesByJournal[key] = [];
            linesByJournal[key].push(line);
        }

        return {
            entries: entries.map(e => ({ ...e, lines: linesByJournal[String(e._id)] || [] })),
            meta: { total, page: parseInt(page), limit: lim, totalPages: Math.ceil(total / lim) },
        };
    }

    static async getOverviewSummary(societyId, db, filters = {}) {
        const { ChartOfAccount, JournalEntry } = getLedgerModels(db);
        const { financialYear } = filters;

        // Get balances from cached account balances
        const accounts = await ChartOfAccount.find({ societyId, status: "ACTIVE" }).lean();

        let totalAssets = 0, totalLiabilities = 0, totalIncome = 0, totalExpenses = 0;
        let bankBalance = 0, cashBalance = 0, receivables = 0, payables = 0;

        for (const acc of accounts) {
            const bal = acc.currentBalance || 0;
            switch (acc.accountType) {
                case "ASSET":
                    totalAssets += bal;
                    if (acc.accountCode.startsWith("101")) bankBalance += bal;
                    if (acc.accountCode === "1011") { bankBalance -= bal; cashBalance += bal; }
                    if (acc.accountCode.startsWith("102")) receivables += bal;
                    break;
                case "LIABILITY":
                    totalLiabilities += bal;
                    if (acc.accountCode.startsWith("203")) payables += bal;
                    break;
                case "INCOME": totalIncome += bal; break;
                case "EXPENSE": totalExpenses += bal; break;
            }
        }

        // Recent activity
        const recentJournals = await JournalEntry.find({ societyId, status: "POSTED" })
            .sort({ postedAt: -1 }).limit(5)
            .populate("createdBy", "name")
            .lean();

        const pendingApprovals = await JournalEntry.countDocuments({ societyId, status: "PENDING_APPROVAL" });
        const recentReversals = await JournalEntry.find({ societyId, isReversal: true })
            .sort({ createdAt: -1 }).limit(5).lean();

        return {
            summary: {
                totalAssets,
                totalLiabilities,
                totalIncome,
                totalExpenses,
                netBalance: totalIncome - totalExpenses,
                receivables,
                payables,
                bankBalance,
                cashBalance,
                pendingApprovals,
            },
            recentJournals,
            recentReversals,
        };
    }

    static async getJournalEntry(societyId, journalId, db) {
        const { JournalEntry, JournalEntryLine } = getLedgerModels(db);
        const je = await JournalEntry.findOne({ _id: journalId, societyId })
            .populate("createdBy", "name email")
            .populate("approvedBy", "name email")
            .populate("postedBy", "name email")
            .populate("reversalOfJournalId", "journalNumber status")
            .populate("reversedByJournalId", "journalNumber status")
            .lean();
        if (!je) throw new AppError("Journal entry not found.", 404);

        const lines = await JournalEntryLine.find({ journalId, societyId })
            .populate("accountId", "accountCode accountName accountType normalBalanceType")
            .lean();

        return { ...je, lines };
    }

    static async getAuditLogs(societyId, db, filters = {}) {
        const { LedgerAuditLog } = getLedgerModels(db);
        const { page = 1, limit = 50, entity, action, startDate, endDate } = filters;
        const skip = (parseInt(page) - 1) * Math.min(parseInt(limit), 100);
        const lim = Math.min(parseInt(limit) || 50, 100);

        const q = { societyId };
        if (entity) q.entity = entity;
        if (action) q.action = action;
        if (startDate || endDate) {
            q.timestamp = {};
            if (startDate) q.timestamp.$gte = new Date(startDate);
            if (endDate) q.timestamp.$lte = new Date(endDate);
        }

        const [logs, total] = await Promise.all([
            LedgerAuditLog.find(q).sort({ timestamp: -1 }).skip(skip).limit(lim)
                .populate("userId", "name email").lean(),
            LedgerAuditLog.countDocuments(q),
        ]);

        return { logs, meta: { total, page: parseInt(page), limit: lim, totalPages: Math.ceil(total / lim) } };
    }

    static async getAccountingPeriods(societyId, db, filters = {}) {
        const { AccountingPeriod } = getLedgerModels(db);
        const q = { societyId };
        if (filters.financialYear) q.financialYear = filters.financialYear;
        if (filters.status) q.status = filters.status;
        return AccountingPeriod.find(q).sort({ startDate: -1 }).lean();
    }

    static async closePeriod(societyId, userId, periodId, db) {
        const { AccountingPeriod, JournalEntry } = getLedgerModels(db);
        const period = await AccountingPeriod.findOne({ _id: periodId, societyId }).lean();
        if (!period) throw new AppError("Accounting period not found.", 404);
        if (period.status === "CLOSED") throw new AppError("This period is already closed.", 422);

        const pendingCount = await JournalEntry.countDocuments({
            societyId, status: { $in: ["DRAFT", "PENDING_APPROVAL", "APPROVED"] },
            transactionDate: { $gte: period.startDate, $lte: period.endDate },
        });
        if (pendingCount > 0) {
            throw new AppError(`Cannot close period. There are ${pendingCount} unposted or pending journal entries in this period.`, 422, "PENDING_ENTRIES");
        }

        const updated = await AccountingPeriod.findByIdAndUpdate(periodId, {
            status: "CLOSED", closedAt: new Date(), closedBy: userId,
        }, { new: true });

        await logLedgerAction({ db, societyId, userId, userRole: "admin",
            action: "PERIOD_CLOSED", entity: "AccountingPeriod", entityId: periodId,
            newValue: { periodCode: period.periodCode, periodName: period.periodName },
        });
        return updated;
    }

    static async reopenPeriod(societyId, userId, periodId, reason, db) {
        const { AccountingPeriod } = getLedgerModels(db);
        if (!reason) throw new AppError("Reason is required to reopen an accounting period.", 400);
        const period = await AccountingPeriod.findOne({ _id: periodId, societyId }).lean();
        if (!period) throw new AppError("Accounting period not found.", 404);
        if (period.status !== "CLOSED") throw new AppError("This period is not closed.", 422);

        const updated = await AccountingPeriod.findByIdAndUpdate(periodId, {
            status: "OPEN", reopenedAt: new Date(), reopenedBy: userId, reopenReason: reason,
        }, { new: true });

        await logLedgerAction({ db, societyId, userId, userRole: "admin",
            action: "PERIOD_REOPENED", entity: "AccountingPeriod", entityId: periodId,
            reason, newValue: { periodCode: period.periodCode },
        });
        return updated;
    }
}

// ─── Automatic Posting Engine — called by other modules ──────────────────────

/**
 * Generate and immediately post a double-entry journal entry for a financial event.
 * Used by Invoice, Payment, Advance, Deposit, Expense, Transfer modules.
 */
async function generateAutomaticPosting(eventPayload, db) {
    const {
        societyId, userId, userRole = "system",
        eventType, amount, transactionDate,
        debitAccountCode, creditAccountCode,
        description, referenceId, referenceNumber,
        idempotencyKey, residentId, flatId,
    } = eventPayload;

    const { ChartOfAccount } = getLedgerModels(db);

    // Resolve accounts by code within this society
    const [debitAcc, creditAcc] = await Promise.all([
        ChartOfAccount.findOne({ societyId, accountCode: debitAccountCode, status: "ACTIVE" }).lean(),
        ChartOfAccount.findOne({ societyId, accountCode: creditAccountCode, status: "ACTIVE" }).lean(),
    ]);

    if (!debitAcc) {
        console.warn(`[LEDGER] Auto-posting failed: Debit account '${debitAccountCode}' not found for society ${societyId}.`);
        return null;
    }
    if (!creditAcc) {
        console.warn(`[LEDGER] Auto-posting failed: Credit account '${creditAccountCode}' not found for society ${societyId}.`);
        return null;
    }

    const lines = [
        { accountId: debitAcc._id, debit: amount, credit: 0, description },
        { accountId: creditAcc._id, debit: 0, credit: amount, description },
    ];

    try {
        const result = await LedgerService.postJournalEntry({
            societyId, userId, userRole,
            description,
            transactionDate: transactionDate || new Date(),
            referenceType: eventType,
            referenceId, referenceNumber,
            idempotencyKey,
            lines,
            isAutomatic: true,
            residentId: residentId || null,
            flatId: flatId || null,
            db,
        });
        return result;
    } catch (err) {
        // Log and surface — do NOT silently swallow posting errors
        console.error(`[LEDGER] Auto-posting error for event '${eventType}':`, err.message);
        throw err;
    }
}

module.exports = { LedgerService, generateAutomaticPosting, getFinancialYear, getAccountingPeriod, logLedgerAction };
