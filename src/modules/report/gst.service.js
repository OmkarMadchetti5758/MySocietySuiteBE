"use strict";

const mongoose = require("mongoose");
const { getLedgerModels } = require("../ledger/ledger.model");
const { getBillingModels } = require("../billing/billing.model");
const { ReportSettingsService } = require("./reportSettings.service");
const { toPaise, fromPaise } = require("./money");

async function getGSTReport(opts) {
    const { societyId, from, to, db } = opts;

    const sid = new mongoose.Types.ObjectId(societyId);

    const fromDate = from ? new Date(from) : new Date(new Date().getFullYear(), 3, 1);
    const toDate   = to   ? new Date(to)   : new Date();
    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);

    const settings = await ReportSettingsService.getSettings(societyId, db);
    // TODO(BA): confirm CGST/SGST vs IGST split per society — defaulting to CGST_SGST 50/50
    const gstSplit = settings.gstSplit || "CGST_SGST";

    const { BillingInvoice, CreditNote } = getBillingModels(db);
    const { ChartOfAccount, JournalEntry, JournalEntryLine } = getLedgerModels(db);

    // ── Step 1: GST on POSTED Invoices in period (by invoice date for accrual basis) ──
    const invoices = await BillingInvoice.find({
        societyId: sid,
        status: { $nin: ["CANCELLED", "cancelled"] },
        invoiceDate: { $gte: fromDate, $lte: toDate },
    }, "lineItems totalGst cgst sgst invoiceDate invoiceNumber flatId").lean();

    // ── Step 2: Credit notes issued in period (reduce taxable value + tax) ──
    // FR-B11 C: credit notes reduce in the period they are ISSUED (not the original invoice period)
    const creditNotes = await CreditNote.find({
        societyId: sid,
        status: "approved",
        createdAt: { $gte: fromDate, $lte: toDate },
    }, "amount reason invoiceId createdAt").lean();

    // Build per-charge-head-per-rate aggregation
    // chargeHeadCode|rate -> { chargeHeadCode, chargeHeadName, gstRate, taxableValuePaise, gstAmountPaise, cgstPaise, sgstPaise, igstPaise, invoiceCount }
    const headMap = new Map();

    for (const inv of invoices) {
        for (const line of (inv.lineItems || [])) {
            if (!line.gstApplicable || !line.gstRate) continue;

            const key = `${line.chargeHeadCode || "UNKNOWN"}|${line.gstRate}`;
            if (!headMap.has(key)) {
                headMap.set(key, {
                    chargeHeadCode: line.chargeHeadCode || "UNKNOWN",
                    chargeHeadName: line.chargeHeadName || line.chargeHeadCode || "Unknown",
                    gstRate:        line.gstRate,
                    taxableValuePaise: 0,
                    gstAmountPaise: 0,
                    cgstPaise: 0,
                    sgstPaise: 0,
                    igstPaise: 0,
                    invoiceCount: 0,
                });
            }

            const entry = headMap.get(key);
            entry.taxableValuePaise += toPaise(line.baseAmount || 0);
            entry.gstAmountPaise    += toPaise(line.gstAmount || 0);
            entry.invoiceCount++;

            // Split GST as per settings
            if (gstSplit === "CGST_SGST") {
                // 50/50 split — round half-up each; final paise may differ by 1 from total
                const halfPaise = Math.round(toPaise(line.gstAmount || 0) / 2);
                entry.cgstPaise += halfPaise;
                entry.sgstPaise += toPaise(line.gstAmount || 0) - halfPaise;
            } else {
                // IGST
                entry.igstPaise += toPaise(line.gstAmount || 0);
            }
        }
    }

    // ── Credit note reductions (distributed to a special "credit note" row) ──
    // We treat credit notes as a reduction in taxable value.
    // Since credit notes don't always carry per-line GST info, we show them as a summary reduction.
    let creditNoteTaxableReducePaise = 0;
    let creditNoteGstReducePaise     = 0;

    for (const cn of creditNotes) {
        // Credit note amount is the total reduction incl. GST if any
        // TODO(BA): If credit notes carry separate GST breakdowns, refine this.
        // For now, assume the credit note amount is GST-inclusive at the society's default GST rate.
        creditNoteTaxableReducePaise += toPaise(cn.amount || 0);
    }

    // ── Step 3: GST on EXPENSES / Vendor Payments (input GST paid) ──
    // Find JE lines on account 1030 (GST Input) in period
    const gstInputAcc = await ChartOfAccount.findOne({
        societyId: sid,
        accountCode: "1030",
    }).lean();

    let gstPaidOnExpensesPaise = 0;
    if (gstInputAcc) {
        const expAgg = await JournalEntryLine.aggregate([
            {
                $match: {
                    societyId: sid,
                    accountId: gstInputAcc._id,
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
                    "_je.postingDate": { $gte: fromDate, $lte: toDate },
                },
            },
            { $group: { _id: null, total: { $sum: "$debit" } } },
        ]);
        gstPaidOnExpensesPaise = toPaise((expAgg[0] || {}).total || 0);
    }

    // ── Step 4: GST Payable ledger balance for reconciliation ──
    const gstPayableAcc = await ChartOfAccount.findOne({
        societyId: sid,
        accountCode: "2050",
    }).lean();

    let ledgerGstPayablePaise = 0;
    if (gstPayableAcc) {
        const gstAgg = await JournalEntryLine.aggregate([
            {
                $match: {
                    societyId: sid,
                    accountId: gstPayableAcc._id,
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
                    "_je.postingDate": { $gte: fromDate, $lte: toDate },
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
        const gst = gstAgg[0] || { totalDebit: 0, totalCredit: 0 };
        // GST Payable is CREDIT-normal: net credits = liability increases
        ledgerGstPayablePaise = toPaise(gst.totalCredit) - toPaise(gst.totalDebit);
    }

    // ── Build response rows ──
    const rows = Array.from(headMap.values()).map(h => ({
        chargeHeadCode: h.chargeHeadCode,
        chargeHeadName: h.chargeHeadName,
        gstRate:        h.gstRate,
        taxableValue:   fromPaise(h.taxableValuePaise),
        gstCollected:   fromPaise(h.gstAmountPaise),
        ...(gstSplit === "CGST_SGST"
            ? { cgst: fromPaise(h.cgstPaise), sgst: fromPaise(h.sgstPaise) }
            : { igst: fromPaise(h.igstPaise) }),
        invoiceCount:   h.invoiceCount,
    }));

    // Totals from invoice lines
    const totalTaxableValuePaise = Array.from(headMap.values()).reduce((s, h) => s + h.taxableValuePaise, 0);
    const totalGstCollectedPaise = Array.from(headMap.values()).reduce((s, h) => s + h.gstAmountPaise, 0);

    // Net GST payable = GST collected - GST input credit - credit note reductions
    const netGstPayablePaise = totalGstCollectedPaise - gstPaidOnExpensesPaise - creditNoteGstReducePaise;

    return {
        period: {
            from: fromDate.toISOString().split("T")[0],
            to:   toDate.toISOString().split("T")[0],
        },
        generatedAt: new Date().toISOString(),
        gstSplit,
        rows,
        creditNoteReductions: {
            taxableValueReduction: fromPaise(creditNoteTaxableReducePaise),
            gstReduction:          fromPaise(creditNoteGstReducePaise),
            count:                 creditNotes.length,
        },
        gstOnExpenses: {
            inputTaxPaid: fromPaise(gstPaidOnExpensesPaise),
        },
        totals: {
            taxableValue:    fromPaise(totalTaxableValuePaise),
            gstCollected:    fromPaise(totalGstCollectedPaise),
            inputTaxCredit:  fromPaise(gstPaidOnExpensesPaise),
            netGstPayable:   fromPaise(netGstPayablePaise),
        },
        // Reconciliation row (Invariant 2) — GST collected must equal ledger GST Payable credits
        reconciliation: {
            invoiceLinesGstCollected: fromPaise(totalGstCollectedPaise),
            ledgerGstPayable:         fromPaise(ledgerGstPayablePaise),
            delta: fromPaise(ledgerGstPayablePaise - totalGstCollectedPaise),
        },
    };
}

module.exports = { getGSTReport };
