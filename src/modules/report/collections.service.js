"use strict";

const mongoose = require("mongoose");
const { getLedgerModels } = require("../ledger/ledger.model");
const { getBillingModels } = require("../billing/billing.model");
const { toPaise, fromPaise } = require("./money");

async function getCollections(opts) {
    const {
        societyId,
        from,
        to,
        flatId,
        block,
        mode,
        accountId,
        page     = 1,
        pageSize = 50,
        db,
    } = opts;

    const sid = new mongoose.Types.ObjectId(societyId);

    const fromDate = from ? new Date(from) : (() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; })();
    const toDate   = to   ? new Date(to)   : new Date();
    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);

    const { BillingInvoice, InvoicePayment } = getBillingModels(db);
    const { ChartOfAccount, JournalEntry, JournalEntryLine } = getLedgerModels(db);

    // ── Receipts from InvoicePayment (regular + advance/excess) ──
    const paymentMatch = {
        societyId: sid,
        paymentDate: { $gte: fromDate, $lte: toDate },
    };
    if (flatId) paymentMatch.flatId = new mongoose.Types.ObjectId(flatId);
    if (mode)   paymentMatch.paymentMode = mode.toUpperCase();

    // Look up block filter via invoice if provided
    let blockFlatIds = null;
    if (block) {
        const blockFlats = await BillingInvoice.distinct("flatId", { societyId: sid, blockName: block });
        blockFlatIds = blockFlats;
        paymentMatch.flatId = { $in: blockFlatIds };
    }

    const paymentPipeline = [
        { $match: paymentMatch },
        {
            $lookup: {
                from: "billinginvoices",
                localField: "invoiceId",
                foreignField: "_id",
                as: "_inv",
            },
        },
        {
            $addFields: {
                invoiceNumber: { $arrayElemAt: ["$_inv.invoiceNumber", 0] },
                billingPeriod: { $arrayElemAt: ["$_inv.billingPeriod", 0] },
                flatNumber:    { $arrayElemAt: ["$_inv.flatNumber", 0] },
                blockName:     { $arrayElemAt: ["$_inv.blockName", 0] },
                residentName:  { $arrayElemAt: ["$_inv.residentName", 0] },
            },
        },
        { $unset: "_inv" },
        {
            $addFields: {
                isAdvance: { $gt: ["$excessAmount", 0] },
            },
        },
    ];

    // Totals pipeline (all rows, no pagination)
    const totalsPipeline = [
        ...paymentPipeline,
        {
            $group: {
                _id: null,
                totalCollected:       { $sum: "$amountPaid" },
                totalAdvance:         { $sum: "$excessAmount" },
                count:                { $sum: 1 },
                byMode: {
                    $push: { mode: "$paymentMode", amount: "$amountPaid" }
                },
            },
        },
    ];

    // Sorted paginated rows
    const rowsPipeline = [
        ...paymentPipeline,
        { $sort: { paymentDate: -1, receiptNumber: 1 } },
        { $skip: (page - 1) * pageSize },
        { $limit: pageSize },
        {
            $project: {
                _id: 1,
                paymentDate:     1,
                receiptNumber:   1,
                flatNumber:      1,
                blockName:       1,
                residentName:    1,
                invoiceId:       1,
                invoiceNumber:   1,
                billingPeriod:   1,
                paymentMode:     1,
                paymentAccount:  1,
                amountPaid:      1,
                excessAmount:    1,
                isAdvance:       1,
                referenceNumber: 1,
                recordedBy:      1,
            },
        },
    ];

    const [rows, totalsArr] = await Promise.all([
        InvoicePayment.aggregate(rowsPipeline),
        InvoicePayment.aggregate(totalsPipeline),
    ]);

    const aggTotals = totalsArr[0] || {};

    // Mode subtotals
    const modeMap = {};
    for (const entry of (aggTotals.byMode || [])) {
        modeMap[entry.mode] = addPaise(toPaise(modeMap[entry.mode] || 0) + toPaise(entry.amount), 0);
    }

    // ── Ledger reconciliation (Invariant 1) ──
    // Collection total must equal Bank + Cash GL debits from member receipts in period.
    // We query JournalEntries with referenceType PAYMENT posted in period, sum Bank/Cash debit lines.
    const bankAccounts = await ChartOfAccount.find({
        societyId: sid,
        accountType: "ASSET",
        accountCode: { $in: ["1010", "1011"] },
    }, "_id accountCode accountName").lean();

    let ledgerBankCashTotalPaise = 0;
    if (bankAccounts.length > 0) {
        const bankAccIds = bankAccounts.map(a => a._id);
        const ledgerAgg = await JournalEntryLine.aggregate([
            {
                $match: {
                    societyId: sid,
                    accountId: { $in: bankAccIds },
                    debit: { $gt: 0 },
                },
            },
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
                    "_je.referenceType": { $in: ["PAYMENT", "ADVANCE_RECEIVED"] },
                    "_je.postingDate": { $gte: fromDate, $lte: toDate },
                },
            },
            {
                $group: {
                    _id: null,
                    totalDebit: { $sum: "$debit" },
                },
            },
        ]);
        ledgerBankCashTotalPaise = toPaise((ledgerAgg[0] || {}).totalDebit || 0);
    }

    const invoiceTotalPaise = toPaise(aggTotals.totalCollected || 0);

    // Format rows
    const formattedRows = rows.map(r => ({
        id:             r._id,
        paymentDate:    r.paymentDate ? r.paymentDate.toISOString().split("T")[0] : null,
        receiptNumber:  r.receiptNumber || null,
        flatNumber:     r.flatNumber    || "",
        blockName:      r.blockName     || "",
        residentName:   r.residentName  || "",
        invoiceNumber:  r.invoiceNumber || null,
        billingPeriod:  r.billingPeriod || null,
        mode:           r.paymentMode   || "OTHER",
        bankAccount:    r.paymentAccount || null,
        amountPaid:     fromPaise(toPaise(r.amountPaid)),
        excessAmount:   fromPaise(toPaise(r.excessAmount || 0)),
        isAdvance:      r.isAdvance || false,
        referenceNumber: r.referenceNumber || null,
    }));

    // Mode subtotals as final obj
    const modeSubtotals = {};
    for (const [m, p] of Object.entries(modeMap)) {
        modeSubtotals[m] = fromPaise(p);
    }

    return {
        period: {
            from: fromDate.toISOString().split("T")[0],
            to:   toDate.toISOString().split("T")[0],
        },
        generatedAt: new Date().toISOString(),
        rows: formattedRows,
        totals: {
            totalCollected: fromPaise(invoiceTotalPaise),
            totalAdvance:   fromPaise(toPaise(aggTotals.totalAdvance || 0)),
            count:          aggTotals.count || 0,
            byMode:         modeSubtotals,
        },
        reconciliation: {
            invoicePaymentsTotal:    fromPaise(invoiceTotalPaise),
            ledgerBankCashReceipts:  fromPaise(ledgerBankCashTotalPaise),
            delta: fromPaise(ledgerBankCashTotalPaise - invoiceTotalPaise),
        },
        meta: {
            page,
            pageSize,
            totalCount: aggTotals.count || 0,
            hasMore: (aggTotals.count || 0) > (page - 1) * pageSize + rows.length,
        },
    };
}

function addPaise(a) { return a; } // Simple pass-through since used for init

module.exports = { getCollections };
