"use strict";

const mongoose = require("mongoose");
const { getLedgerModels } = require("../ledger/ledger.model");
const { toPaise, fromPaise } = require("./money");

async function computeAccountBalances(societyId, asOfDate, db) {
    const { ChartOfAccount, JournalEntry, JournalEntryLine } = getLedgerModels(db);
    const sid = new mongoose.Types.ObjectId(societyId);

    // Aggregate all posted lines up to asOf — single pass
    const lineAgg = await JournalEntryLine.aggregate([
        { $match: { societyId: sid } },
        {
            $lookup: {
                from: "journalentries",
                localField: "journalId",
                foreignField: "_id",
                as: "_je",
            },
        },
        {
            $match: {
                "_je.status": "POSTED",
                "_je.postingDate": { $lte: asOfDate },
            },
        },
        {
            $group: {
                _id: "$accountId",
                totalDebit: { $sum: "$debit" },
                totalCredit: { $sum: "$credit" },
            },
        },
    ]);

    const rawBalances = new Map();
    for (const row of lineAgg) {
        rawBalances.set(String(row._id), {
            debit: toPaise(row.totalDebit),
            credit: toPaise(row.totalCredit),
        });
    }

    // Fetch all active accounts for this society
    const accounts = await ChartOfAccount.find({ societyId: sid, status: "ACTIVE" }).lean();

    // Compute signed balance per account (positive = balance on normal side)
    const balanceMap = new Map(); // accountId -> paiseBalance
    for (const acc of accounts) {
        const key = String(acc._id);
        const raw = rawBalances.get(key) || { debit: 0, credit: 0 };
        const balance = acc.normalBalanceType === "DEBIT"
            ? raw.debit - raw.credit      // ASSET, EXPENSE
            : raw.credit - raw.debit;     // LIABILITY, EQUITY, INCOME
        balanceMap.set(key, balance);
    }

    return { balanceMap, accounts };
}

function buildSection(accounts, balanceMap, accountType) {
    const sectionAccounts = accounts.filter(a => a.accountType === accountType);
    const byId = new Map(sectionAccounts.map(a => [String(a._id), a]));

    // Build parent→children map
    const children = new Map();
    for (const acc of sectionAccounts) {
        const pid = acc.parentAccountId ? String(acc.parentAccountId) : null;
        if (!children.has(pid)) children.set(pid, []);
        children.get(pid).push(acc);
    }

    // Find root accounts (no parent, or parent not in this section)
    const roots = sectionAccounts.filter(a => {
        if (!a.parentAccountId) return true;
        return !byId.has(String(a.parentAccountId));
    });

    function buildNode(acc) {
        const id = String(acc._id);
        const ownBalance = balanceMap.get(id) || 0;
        const childAccs = children.get(id) || [];
        const childNodes = childAccs.map(buildNode);

        // Roll-up: parent balance = own balance + sum of children roll-ups
        const childrenTotal = childNodes.reduce((s, n) => s + n._rollupPaise, 0);
        const rollupPaise = ownBalance + childrenTotal;

        return {
            accountId: id,
            accountCode: acc.accountCode,
            accountName: acc.accountName,
            balance: fromPaise(rollupPaise),
            _rollupPaise: rollupPaise,   // internal; stripped before response
            children: childNodes.map(({ _rollupPaise: _, ...rest }) => rest),
        };
    }

    return roots.map(r => {
        const node = buildNode(r);
        const { _rollupPaise, ...clean } = node;
        // Re-strip _rollupPaise from all children (deep)
        return clean;
    });
}

// Recursive helper to sum a section from its tree nodes
function sumSection(nodes) {
    return nodes.reduce((s, n) => {
        const own = toPaise(n.balance);
        return s + own;
    }, 0);
}

async function getBalanceSheet(opts) {
    const { societyId, asOf, db } = opts;

    const asOfDate = asOf ? new Date(asOf) : new Date();
    asOfDate.setHours(23, 59, 59, 999);

    const { balanceMap, accounts } = await computeAccountBalances(societyId, asOfDate, db);

    // ── Build sections ──
    const assets = buildSection(accounts, balanceMap, "ASSET");
    const liabilities = buildSection(accounts, balanceMap, "LIABILITY");
    const equity = buildSection(accounts, balanceMap, "EQUITY");

    // Current-period surplus: Income - Expense (from INCOME/EXPENSE accounts, same as P&L total)
    // We compute this from the ledger balance directly (accounts with type INCOME/EXPENSE)
    const incomeAccounts = accounts.filter(a => a.accountType === "INCOME");
    const expenseAccounts = accounts.filter(a => a.accountType === "EXPENSE");

    let totalIncomePaise = 0;
    let totalExpensePaise = 0;

    for (const acc of incomeAccounts) {
        totalIncomePaise += (balanceMap.get(String(acc._id)) || 0);
    }
    for (const acc of expenseAccounts) {
        totalExpensePaise += (balanceMap.get(String(acc._id)) || 0);
    }

    const surplusPaise = totalIncomePaise - totalExpensePaise;

    // ── Section totals ──
    const totalAssetsPaise = sumSection(assets);
    const totalLiabilitiesPaise = sumSection(liabilities);
    const totalEquityPaise = sumSection(equity);

    // Invariant 2: Total Assets == Total Liabilities + Equity + Surplus
    // The equation is an accounting identity — if the ledger is balanced, this holds.
    // We expose the difference as a "balance check" field (must be 0 in a balanced ledger).
    const liabEquitySurplusPaise = totalLiabilitiesPaise + totalEquityPaise + surplusPaise;
    const balanceCheckPaise = totalAssetsPaise - liabEquitySurplusPaise;

    return {
        asOf: asOfDate.toISOString().split("T")[0],
        generatedAt: new Date().toISOString(),
        sections: {
            assets: {
                label: "Assets",
                total: fromPaise(totalAssetsPaise),
                accounts: assets,
            },
            liabilities: {
                label: "Liabilities",
                total: fromPaise(totalLiabilitiesPaise),
                accounts: liabilities,
            },
            equity: {
                label: "Equity / Reserve Fund",
                total: fromPaise(totalEquityPaise),
                accounts: equity,
            },
            currentPeriodSurplus: {
                label: "Current Period Surplus / (Deficit)",
                // Positive = surplus; negative = deficit
                amount: fromPaise(surplusPaise),
            },
        },
        totals: {
            totalAssets: fromPaise(totalAssetsPaise),
            totalLiabAndEquity: fromPaise(liabEquitySurplusPaise),
            // Invariant 2 check — must equal "0.00" in a balanced ledger
            balanceCheck: fromPaise(balanceCheckPaise),
            isBalanced: balanceCheckPaise === 0,
        },
    };
}

module.exports = { getBalanceSheet, computeAccountBalances };
