"use strict";

const mongoose = require("mongoose");
const { getLedgerModels } = require("../ledger/ledger.model");
const { getBillingModels } = require("../billing/billing.model");
const { getReportModels } = require("./report.model");
const { ReportSettingsService } = require("./reportSettings.service");
const { toPaise, fromPaise, addPaise } = require("./money");

function invoiceOutstandingPaise(inv) {
    const total = toPaise(inv.totalAmount || 0);
    const paid  = toPaise(inv.paidAmount  || 0);
    return Math.max(0, total - paid);
}

function ageBucket(days) {
    if (days <= 0)  return "current";
    if (days <= 30) return "0_30";
    if (days <= 60) return "31_60";
    if (days <= 90) return "61_90";
    return "90_plus";
}

async function getDuesAgeing(opts) {
    const {
        societyId,
        asOf,
        flatId,
        block,
        bucket,
        defaultersOnly = false,
        page = 1,
        pageSize = 50,
        db,
    } = opts;

    const sid = new mongoose.Types.ObjectId(societyId);
    const asOfDate = asOf ? new Date(asOf) : new Date();
    // Set to end of day so invoices issued on asOf are included
    asOfDate.setHours(23, 59, 59, 999);

    const settings = await ReportSettingsService.getSettings(societyId, db);
    const ageingBasis = settings.ageingBasis || "DUE_DATE"; // FR-B11 E.

    const { BillingInvoice } = getBillingModels(db);
    const { ChartOfAccount, JournalEntry, JournalEntryLine } = getLedgerModels(db);

    // ── Step 1: Query outstanding invoices (status != CANCELLED, invoiceDate <= asOf) ──
    // "Outstanding" = totalAmount > paidAmount
    const invoiceMatch = {
        societyId: sid,
        status: { $nin: ["CANCELLED", "cancelled"] },
        invoiceDate: { $lte: asOfDate },
        $expr: { $gt: ["$totalAmount", "$paidAmount"] },
    };
    if (flatId) invoiceMatch.flatId = new mongoose.Types.ObjectId(flatId);
    if (block)  invoiceMatch.blockName = block;

    // Determine the ageing reference field from settings (BRD 6.3 — must be explicit)
    const agingRefField = ageingBasis === "INVOICE_DATE" ? "$invoiceDate" : "$dueDate";

    // ── Aggregate outstanding invoices grouped by flat ──
    const pipeline = [
        { $match: invoiceMatch },
        {
            $addFields: {
                outstandingAmount: { $subtract: ["$totalAmount", "$paidAmount"] },
                ageRefDate: agingRefField,
                daysPast: {
                    $dateDiff: {
                        startDate: agingRefField,
                        endDate: new Date(asOfDate),
                        unit: "day",
                    },
                },
            },
        },
        {
            $group: {
                _id: "$flatId",
                flatNumber: { $first: "$flatNumber" },
                blockName:  { $first: "$blockName" },
                residentName: { $first: "$residentName" },
                userId:     { $first: "$userId" },
                totalOutstanding: { $sum: "$outstandingAmount" },
                fineAmount:       { $sum: "$fineAmount" },
                oldestDueDate:    { $min: "$dueDate" },
                invoiceCount:     { $sum: 1 },
                // Bucket contributions (sum into each bucket)
                bucket_current: {
                    $sum: {
                        $cond: [{ $lte: ["$daysPast", 0] }, "$outstandingAmount", 0]
                    }
                },
                bucket_0_30: {
                    $sum: {
                        $cond: [
                            { $and: [{ $gt: ["$daysPast", 0] }, { $lte: ["$daysPast", 30] }] },
                            "$outstandingAmount", 0
                        ]
                    }
                },
                bucket_31_60: {
                    $sum: {
                        $cond: [
                            { $and: [{ $gt: ["$daysPast", 30] }, { $lte: ["$daysPast", 60] }] },
                            "$outstandingAmount", 0
                        ]
                    }
                },
                bucket_61_90: {
                    $sum: {
                        $cond: [
                            { $and: [{ $gt: ["$daysPast", 60] }, { $lte: ["$daysPast", 90] }] },
                            "$outstandingAmount", 0
                        ]
                    }
                },
                bucket_90_plus: {
                    $sum: {
                        $cond: [{ $gt: ["$daysPast", 90] }, "$outstandingAmount", 0]
                    }
                },
            },
        },
    ];

    // Look up the defaulter flag from Flat collection (FR-B11 E — read existing flag, don't recompute)
    pipeline.push({
        $lookup: {
            from: "flats",
            localField: "_id",
            foreignField: "_id",
            as: "_flatDoc",
        }
    });
    pipeline.push({
        $addFields: {
            isDefaulter: { $ifNull: [{ $arrayElemAt: ["$_flatDoc.isDefaulter", 0] }, false] },
        }
    });
    pipeline.push({ $unset: "_flatDoc" });

    if (defaultersOnly) {
        pipeline.push({ $match: { isDefaulter: true } });
    }

    // Bucket filter
    if (bucket) {
        const bucketField = {
            current: "bucket_current",
            "0_30":  "bucket_0_30",
            "31_60": "bucket_31_60",
            "61_90": "bucket_61_90",
            "90_plus": "bucket_90_plus",
        }[bucket];
        if (bucketField) {
            pipeline.push({ $match: { [bucketField]: { $gt: 0 } } });
        }
    }

    // Sort by oldest due date descending (worst defaulters first)
    pipeline.push({ $sort: { oldestDueDate: 1, flatNumber: 1 } });

    // ── Compute totals across all matching rows (before pagination) ──
    const totalsPipeline = [...pipeline, {
        $group: {
            _id: null,
            totalOutstanding: { $sum: "$totalOutstanding" },
            totalFines:       { $sum: "$fineAmount" },
            totalFlats:       { $sum: 1 },
            totalBucket_current:  { $sum: "$bucket_current" },
            totalBucket_0_30:     { $sum: "$bucket_0_30" },
            totalBucket_31_60:    { $sum: "$bucket_31_60" },
            totalBucket_61_90:    { $sum: "$bucket_61_90" },
            totalBucket_90_plus:  { $sum: "$bucket_90_plus" },
        },
    }];

    // Paginated rows
    const skip = (page - 1) * pageSize;
    const rowsPipeline = [...pipeline, { $skip: skip }, { $limit: pageSize }];

    const [rows, totalsArr] = await Promise.all([
        BillingInvoice.aggregate(rowsPipeline),
        BillingInvoice.aggregate(totalsPipeline),
    ]);

    const aggTotals = totalsArr[0] || {};

    // ── Step 2: Ledger reconciliation check (Invariant 1) ──
    // Dues total must equal Members' Receivable ledger balance as of asOf.
    // We compute the ledger balance and expose it as a reconciliation row (not enforced as error here
    // — the automated test asserts equality; the report shows both for transparency).
    const memberReceivableAcc = await ChartOfAccount.findOne({
        societyId: sid,
        accountCode: "1021",
    }).lean();

    let ledgerReceivableBalancePaise = null;
    if (memberReceivableAcc) {
        // Sum all POSTED journal lines on this account up to asOf
        const ledgerAgg = await JournalEntryLine.aggregate([
            {
                $match: {
                    societyId: sid,
                    accountId: memberReceivableAcc._id,
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
                    "_je.postingDate": { $lte: asOfDate },
                },
            },
            {
                $group: {
                    _id: null,
                    totalDebit:  { $sum: "$debit" },
                    totalCredit: { $sum: "$credit" },
                },
            },
        ]);
        const ledger = ledgerAgg[0] || { totalDebit: 0, totalCredit: 0 };
        // Members' Receivable is a DEBIT-normal account → balance = debit - credit
        ledgerReceivableBalancePaise = toPaise(ledger.totalDebit) - toPaise(ledger.totalCredit);
    }

    // ── Build response rows (convert paise to formatted strings) ──
    const formattedRows = rows.map(r => ({
        flatId:          r._id,
        flatNumber:      r.flatNumber || "",
        blockName:       r.blockName  || "",
        residentName:    r.residentName || "",
        isDefaulter:     r.isDefaulter || false,
        invoiceCount:    r.invoiceCount,
        oldestDueDate:   r.oldestDueDate ? r.oldestDueDate.toISOString().split("T")[0] : null,
        outstanding: {
            principal:    fromPaise(toPaise(r.totalOutstanding) - toPaise(r.fineAmount)),
            fines:        fromPaise(toPaise(r.fineAmount)),
            total:        fromPaise(toPaise(r.totalOutstanding)),
        },
        buckets: {
            current:   fromPaise(toPaise(r.bucket_current)),
            "0_30":    fromPaise(toPaise(r.bucket_0_30)),
            "31_60":   fromPaise(toPaise(r.bucket_31_60)),
            "61_90":   fromPaise(toPaise(r.bucket_61_90)),
            "90_plus": fromPaise(toPaise(r.bucket_90_plus)),
        },
    }));

    const totalsOutstandingPaise = toPaise(aggTotals.totalOutstanding || 0);
    const totalFinesPaise        = toPaise(aggTotals.totalFines        || 0);

    return {
        asOf:       asOfDate.toISOString().split("T")[0],
        generatedAt: new Date().toISOString(),
        ageingBasis,
        rows: formattedRows,
        totals: {
            flatCount:   aggTotals.totalFlats   || 0,
            principal:   fromPaise(totalsOutstandingPaise - totalFinesPaise),
            fines:       fromPaise(totalFinesPaise),
            outstanding: fromPaise(totalsOutstandingPaise),
            buckets: {
                current:   fromPaise(toPaise(aggTotals.totalBucket_current  || 0)),
                "0_30":    fromPaise(toPaise(aggTotals.totalBucket_0_30     || 0)),
                "31_60":   fromPaise(toPaise(aggTotals.totalBucket_31_60    || 0)),
                "61_90":   fromPaise(toPaise(aggTotals.totalBucket_61_90    || 0)),
                "90_plus": fromPaise(toPaise(aggTotals.totalBucket_90_plus  || 0)),
            },
        },
        // Reconciliation row (Invariant 1 — exposed for transparency, tested in automated tests)
        reconciliation: {
            ledgerMembersReceivable: ledgerReceivableBalancePaise !== null
                ? fromPaise(ledgerReceivableBalancePaise)
                : null,
            invoiceTotalOutstanding: fromPaise(totalsOutstandingPaise),
            // Delta should be 0 in a consistent ledger
            delta: ledgerReceivableBalancePaise !== null
                ? fromPaise(ledgerReceivableBalancePaise - totalsOutstandingPaise)
                : null,
        },
        meta: {
            page,
            pageSize,
            totalFlats: aggTotals.totalFlats || 0,
            hasMore: (aggTotals.totalFlats || 0) > skip + rows.length,
        },
    };
}

module.exports = { getDuesAgeing };
