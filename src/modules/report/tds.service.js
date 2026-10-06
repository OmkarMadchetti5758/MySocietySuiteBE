"use strict";

const mongoose = require("mongoose");
const { getBillingModels } = require("../billing/billing.model");
const { toPaise, fromPaise } = require("./money");

function maskPAN(pan) {
    if (!pan || pan.length < 10) return pan ? "****" : null;
    // PAN format: AAAAA1234A — mask digits 6-9
    return pan.slice(0, 5) + "****" + pan.slice(-1);
}

async function getTDSStatement(opts) {
    const {
        societyId,
        from,
        to,
        fullPAN  = false,
        page     = 1,
        pageSize = 50,
        db,
    } = opts;

    const sid = new mongoose.Types.ObjectId(societyId);

    const fromDate = from ? new Date(from) : (() => { const d = new Date(); d.setMonth(3); d.setDate(1); d.setHours(0,0,0,0); return d; })();
    const toDate   = to   ? new Date(to)   : new Date();
    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);

    const { VendorPayment } = getBillingModels(db);

    // Query only TDS-applicable PAID payments in period
    const matchStage = {
        societyId: sid,
        tdsApplicable: true,
        status: { $in: ["paid", "PAID"] },
        paidAt: { $gte: fromDate, $lte: toDate },
    };

    // Look up vendor PAN / category via join
    const pipeline = [
        { $match: matchStage },
        {
            $lookup: {
                from: "vendors",
                localField: "vendorId",
                foreignField: "_id",
                as: "_vendor",
            },
        },
        {
            $addFields: {
                vendorPAN:      { $ifNull: [{ $arrayElemAt: ["$_vendor.pan", 0] }, null] },
                tdsCategory:    { $ifNull: [{ $arrayElemAt: ["$_vendor.tdsCategory", 0] }, "$tdsSection"] },
                vendorNameFull: { $ifNull: [{ $arrayElemAt: ["$_vendor.name", 0] }, "$vendorName"] },
            },
        },
        { $unset: "_vendor" },
    ];

    // Count all matching (for pagination)
    const countPipeline = [...pipeline, { $count: "total" }];

    // Per-vendor summary subtotals (totals section)
    const summaryPipeline = [
        ...pipeline,
        {
            $group: {
                _id: "$vendorId",
                vendorName:   { $first: "$vendorNameFull" },
                vendorPAN:    { $first: "$vendorPAN" },
                tdsCategory:  { $first: "$tdsCategory" },
                tdsSection:   { $first: "$tdsSection" },
                tdsRate:      { $first: "$tdsRate" },
                grossPayment: { $sum: "$amount" },
                tdsDeducted:  { $sum: "$tdsAmount" },
                netPaid:      { $sum: { $ifNull: ["$netPaid", { $subtract: ["$amount", "$tdsAmount"] }] } },
                paymentCount: { $sum: 1 },
            },
        },
        { $sort: { vendorName: 1 } },
    ];

    // Row-level (paginated)
    const rowsPipeline = [
        ...pipeline,
        { $sort: { paidAt: -1, vendorNameFull: 1 } },
        { $skip: (page - 1) * pageSize },
        { $limit: pageSize },
        {
            $project: {
                _id: 1,
                paymentNumber:  1,
                vendorId:       1,
                vendorName:     "$vendorNameFull",
                vendorPAN:      1,
                tdsCategory:    1,
                tdsSection:     1,
                tdsRate:        1,
                grossAmount:    "$amount",
                tdsAmount:      1,
                netPaid:        { $ifNull: ["$netPaid", { $subtract: ["$amount", "$tdsAmount"] }] },
                paidAt:         1,
                challanRef:     1,
                paymentMode:    1,
            },
        },
    ];

    const [rows, vendorSummaries, countArr] = await Promise.all([
        VendorPayment.aggregate(rowsPipeline),
        VendorPayment.aggregate(summaryPipeline),
        VendorPayment.aggregate(countPipeline),
    ]);

    const totalCount = (countArr[0] || {}).total || 0;

    // Totals
    let totalGrossPaise  = 0;
    let totalTdsPaise    = 0;
    let totalNetPaise    = 0;

    const vendorRows = vendorSummaries.map(v => {
        const grossPaise = toPaise(v.grossPayment || 0);
        const tdsPaise   = toPaise(v.tdsDeducted  || 0);
        const netPaise   = toPaise(v.netPaid       || 0);
        totalGrossPaise += grossPaise;
        totalTdsPaise   += tdsPaise;
        totalNetPaise   += netPaise;

        return {
            vendorId:    v._id,
            vendorName:  v.vendorName || "",
            pan:         fullPAN ? (v.vendorPAN || null) : maskPAN(v.vendorPAN),
            panMasked:   !fullPAN,
            tdsCategory: v.tdsCategory || null,
            tdsSection:  v.tdsSection  || null,
            tdsRate:     v.tdsRate     || null,
            grossPayment: fromPaise(grossPaise),
            tdsDeducted:  fromPaise(tdsPaise),
            netPaid:      fromPaise(netPaise),
            paymentCount: v.paymentCount,
        };
    });

    // Individual payment rows (with PAN masked/unmasked)
    const formattedRows = rows.map(r => ({
        id:            r._id,
        paymentNumber: r.paymentNumber || null,
        vendorId:      r.vendorId,
        vendorName:    r.vendorName || "",
        pan:           fullPAN ? (r.vendorPAN || null) : maskPAN(r.vendorPAN),
        panMasked:     !fullPAN,
        tdsCategory:   r.tdsCategory || null,
        tdsSection:    r.tdsSection  || null,
        tdsRate:       r.tdsRate     || null,
        grossAmount:   fromPaise(toPaise(r.grossAmount   || 0)),
        tdsDeducted:   fromPaise(toPaise(r.tdsAmount     || 0)),
        netPaid:       fromPaise(toPaise(r.netPaid        || 0)),
        paymentDate:   r.paidAt ? r.paidAt.toISOString().split("T")[0] : null,
        challanRef:    r.challanRef   || null,
        paymentMode:   r.paymentMode  || null,
    }));

    return {
        period: {
            from: fromDate.toISOString().split("T")[0],
            to:   toDate.toISOString().split("T")[0],
        },
        generatedAt: new Date().toISOString(),
        fullPANIncluded: fullPAN,
        rows:         formattedRows,
        vendorSummary: vendorRows,
        totals: {
            grossPayment: fromPaise(totalGrossPaise),
            tdsDeducted:  fromPaise(totalTdsPaise),
            netPaid:      fromPaise(totalNetPaise),
            vendorCount:  vendorSummaries.length,
            paymentCount: totalCount,
        },
        meta: {
            page,
            pageSize,
            totalCount,
            hasMore: totalCount > (page - 1) * pageSize + rows.length,
        },
    };
}

module.exports = { getTDSStatement, maskPAN };
