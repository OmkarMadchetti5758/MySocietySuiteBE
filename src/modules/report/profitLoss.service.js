"use strict";

const mongoose = require("mongoose");
const { getLedgerModels } = require("../ledger/ledger.model");
const { ReportSettingsService } = require("./reportSettings.service");
const { toPaise, fromPaise } = require("./money");

async function getProfitLoss(opts) {
    const { societyId, from, to, db } = opts;

    const sid = new mongoose.Types.ObjectId(societyId);

    const fromDate = from ? new Date(from) : (() => { const d = new Date(); d.setMonth(3); d.setDate(1); d.setHours(0,0,0,0); return d; })();
    const toDate   = to   ? new Date(to)   : new Date();
    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);

    const settings = await ReportSettingsService.getSettings(societyId, db);
    const accountingBasis = settings.accountingBasis || "ACCRUAL";

    const { ChartOfAccount, JournalEntry, JournalEntryLine } = getLedgerModels(db);

    // Aggregate posted lines on INCOME and EXPENSE accounts in the period
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
                "_je.postingDate": { $gte: fromDate, $lte: toDate },
            },
        },
        {
            $group: {
                _id: "$accountId",
                totalDebit:  { $sum: "$debit" },
                totalCredit: { $sum: "$credit" },
            },
        },
    ]);

    const rawBalances = new Map();
    for (const row of lineAgg) {
        rawBalances.set(String(row._id), {
            debit:  toPaise(row.totalDebit),
            credit: toPaise(row.totalCredit),
        });
    }

    // Load all INCOME/EXPENSE accounts
    const accounts = await ChartOfAccount.find({
        societyId: sid,
        accountType: { $in: ["INCOME", "EXPENSE"] },
        status: "ACTIVE",
    }).lean();

    const balanceMap = new Map();
    for (const acc of accounts) {
        const key = String(acc._id);
        const raw = rawBalances.get(key) || { debit: 0, credit: 0 };
        // INCOME → credit normal; EXPENSE → debit normal
        const balance = acc.normalBalanceType === "CREDIT"
            ? raw.credit - raw.debit
            : raw.debit  - raw.credit;
        balanceMap.set(key, balance);
    }

    // Build hierarchical section (same logic as Balance Sheet)
    function buildSection(accountType) {
        const sectAccounts = accounts.filter(a => a.accountType === accountType);
        const byId = new Map(sectAccounts.map(a => [String(a._id), a]));
        const children = new Map();
        for (const acc of sectAccounts) {
            const pid = acc.parentAccountId ? String(acc.parentAccountId) : null;
            if (!children.has(pid)) children.set(pid, []);
            children.get(pid).push(acc);
        }
        const roots = sectAccounts.filter(a => {
            if (!a.parentAccountId) return true;
            return !byId.has(String(a.parentAccountId));
        });

        function buildNode(acc) {
            const id = String(acc._id);
            const ownBalance = balanceMap.get(id) || 0;
            const childAccs = children.get(id) || [];
            const childNodes = childAccs.map(buildNode);
            const childrenTotal = childNodes.reduce((s, n) => s + n._rollupPaise, 0);
            const rollupPaise = ownBalance + childrenTotal;
            return {
                accountId:    id,
                accountCode:  acc.accountCode,
                accountName:  acc.accountName,
                balance:      fromPaise(rollupPaise),
                _rollupPaise: rollupPaise,
                children:     childNodes.map(({ _rollupPaise: _, ...rest }) => rest),
            };
        }

        return roots.map(r => {
            const node = buildNode(r);
            const { _rollupPaise, ...clean } = node;
            return clean;
        });
    }

    const incomeTree  = buildSection("INCOME");
    const expenseTree = buildSection("EXPENSE");

    // Section totals
    function sumTree(nodes) {
        return nodes.reduce((s, n) => s + toPaise(n.balance), 0);
    }

    const totalIncomePaise  = sumTree(incomeTree);
    const totalExpensePaise = sumTree(expenseTree);
    const surplusPaise      = totalIncomePaise - totalExpensePaise;

    return {
        period: {
            from: fromDate.toISOString().split("T")[0],
            to:   toDate.toISOString().split("T")[0],
        },
        accountingBasis,
        generatedAt: new Date().toISOString(),
        sections: {
            income: {
                label:    "Income",
                total:    fromPaise(totalIncomePaise),
                accounts: incomeTree,
            },
            expense: {
                label:    "Expenses",
                total:    fromPaise(totalExpensePaise),
                accounts: expenseTree,
            },
        },
        surplus: {
            label:  surplusPaise >= 0 ? "Surplus for the period" : "Deficit for the period",
            amount: fromPaise(surplusPaise),
        },
    };
}

module.exports = { getProfitLoss };
