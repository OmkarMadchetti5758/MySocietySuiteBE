"use strict";

const crypto   = require("crypto");
const path     = require("path");
const mongoose = require("mongoose");
const XLSX   = require("xlsx");
const PDFDocument = require("pdfkit");

const { getReportModels }     = require("./report.model");
const { getDuesAgeing }       = require("./dues.service");
const { getCollections }      = require("./collections.service");
const { getBalanceSheet }     = require("./balanceSheet.service");
const { getProfitLoss }       = require("./profitLoss.service");
const { getGSTReport }        = require("./gst.service");
const { getTDSStatement }     = require("./tds.service");
const { getLedgerModels }     = require("../ledger/ledger.model");

// ── AWS S3 presigned URL helper (re-uses existing aws-sdk setup if present) ──
let s3Client = null;
let PutObjectCommand, GetObjectCommand, DeleteObjectCommand;
let getSignedUrl;
try {
    const { S3Client, PutObjectCommand: P, GetObjectCommand: G, DeleteObjectCommand: D } = require("@aws-sdk/client-s3");
    const { getSignedUrl: gsu } = require("@aws-sdk/s3-request-presigner");
    const env = require("../../config/env");
    if (env.AWS_S3_BUCKET) {
        s3Client = new S3Client({ region: env.AWS_REGION || "ap-south-1" });
        PutObjectCommand    = P;
        GetObjectCommand    = G;
        DeleteObjectCommand = D;
        getSignedUrl        = gsu;
    }
} catch (_) {
    // S3 not configured; exports will be stored locally in /tmp for development
}

const env = require("../../config/env");
const S3_BUCKET = env.AWS_S3_BUCKET || null;
// Download link TTL: 15 minutes
const SIGNED_URL_TTL_SECONDS = 15 * 60;

function computeParamsHash(societyId, reportType, format, params) {
    const canonical = JSON.stringify({ societyId: String(societyId), reportType, format, params }, Object.keys({ societyId: String(societyId), reportType, format, params }).sort());
    return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

async function createExportJob(opts) {
    const { societyId, requestedBy, reportType, format, params, db } = opts;
    const { ExportJob } = getReportModels(db);

    const paramsHash = computeParamsHash(societyId, reportType, format, params);

    // Check for existing job with same params hash (within 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existing = await ExportJob.findOne({
        societyId,
        paramsHash,
        status: { $in: ["PENDING", "PROCESSING", "DONE"] },
        createdAt: { $gte: oneDayAgo },
    }).lean();

    if (existing) {
        // If local dev (no S3), don't cache since tmp_exports might be ephemeral
        if (!s3Client || !S3_BUCKET) {
            // we will create a new job instead
        } else {
            return { job: existing, created: false };
        }
    }

    const job = await ExportJob.create({
        societyId,
        requestedBy,
        reportType,
        format,
        params,
        paramsHash,
        status: "PENDING",
    });

    return { job: job.toObject(), created: true };
}

async function processExportJob(jobId, db) {
    const { ExportJob } = getReportModels(db);
    const job = await ExportJob.findById(jobId);

    if (!job) throw new Error(`Export job ${jobId} not found`);
    if (job.status === "DONE") return job.toObject();

    await ExportJob.updateOne({ _id: jobId }, {
        status: "PROCESSING",
        startedAt: new Date(),
        $inc: { attempts: 1 },
        lastAttemptAt: new Date(),
    });

    try {
        const { societyId, reportType, format, params } = job;

        // Fetch report data
        const reportData = await fetchReportData(reportType, societyId, params, db);

        // Generate file buffer
        let buffer, contentType, extension;

        if (format === "TALLY_XML") {
            buffer      = generateTallyXML(reportData, { societyId, params });
            contentType = "application/xml";
            extension   = "xml";
        } else if (format === "EXCEL") {
            buffer      = generateExcel(reportType, reportData);
            contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            extension   = "xlsx";
        } else if (format === "CSV") {
            buffer      = generateCSV(reportType, reportData);
            contentType = "text/csv";
            extension   = "csv";
        } else if (format === "PDF") {
            buffer      = await generatePDF(reportType, reportData);
            contentType = "application/pdf";
            extension   = "pdf";
        } else {
            throw new Error(`Unknown export format: ${format}`);
        }

        // Upload to S3 or local fallback
        const s3Key = `exports/${societyId}/${reportType.toLowerCase()}_${Date.now()}_${job._id}.${extension}`;
        await uploadBuffer(buffer, s3Key, contentType);

        await ExportJob.updateOne({ _id: jobId }, {
            status:        "DONE",
            s3Key,
            fileSizeBytes: buffer.length,
            completedAt:   new Date(),
        });

        return (await ExportJob.findById(jobId)).toObject();
    } catch (err) {
        await ExportJob.updateOne({ _id: jobId }, {
            status:       "FAILED",
            errorMessage: err.message,
            completedAt:  new Date(),
        });
        throw err;
    }
}

/** Fetch the underlying report data based on reportType */
async function fetchReportData(reportType, societyId, params, db) {
    const opts = { societyId, db, ...params };
    switch (reportType) {
        case "DUES_AGEING":  return getDuesAgeing({ ...opts, pageSize: 10000 });
        case "COLLECTIONS":  return getCollections({ ...opts, pageSize: 10000 });
        case "BALANCE_SHEET": return getBalanceSheet(opts);
        case "PROFIT_LOSS":  return getProfitLoss(opts);
        case "GST":          return getGSTReport(opts);
        case "TDS":          return getTDSStatement({ ...opts, fullPAN: !!params.fullPAN, pageSize: 10000 });
        case "TALLY":        return fetchTallyData(societyId, params, db);
        case "INVOICES":     return fetchInvoicesData(societyId, params, db);
        case "LEDGER_MASTERS": return fetchLedgerMasters(societyId, db);
        default: throw new Error(`Unknown reportType: ${reportType}`);
    }
}

async function uploadBuffer(buffer, s3Key, contentType) {
    if (s3Client && S3_BUCKET) {
        await s3Client.send(new PutObjectCommand({
            Bucket:      S3_BUCKET,
            Key:         s3Key,
            Body:        buffer,
            ContentType: contentType,
            // Server-side encryption
            ServerSideEncryption: "AES256",
        }));
    } else {
        // Development fallback: write to /tmp (never stored publicly)
        const fs  = require("fs");
        const dir = path.join(process.cwd(), "tmp_exports");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, path.basename(s3Key)), buffer);
    }
}

async function getDownloadUrl(job) {
    if (!job || job.status !== "DONE" || !job.s3Key) {
        return null;
    }

    // Already have a non-expired URL
    if (job.downloadUrlExpiresAt && new Date() < new Date(job.downloadUrlExpiresAt)) {
        return job.downloadUrl;
    }

    if (s3Client && S3_BUCKET) {
        const url = await getSignedUrl(
            s3Client,
            new GetObjectCommand({ Bucket: S3_BUCKET, Key: job.s3Key }),
            { expiresIn: SIGNED_URL_TTL_SECONDS }
        );
        return url;
    } else {
        // Dev mode: return the local download endpoint
        const env = require("../../config/env");
        const backendUrl = env.API_URL || env.BACKEND_URL || "http://localhost:5000";
        return `${backendUrl}/api/v1/reports/exports/local/${path.basename(job.s3Key)}`;
    }
}

function generateTallyXML(data, context) {
    const escapeXML = (str) => String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const vouchers = (data.vouchers || []);
    const masters  = (data.masters  || []);

    const masterXML = masters.map(m => `
  <LEDGER NAME="${escapeXML(m.name)}" ACTION="CREATE">
    <NAME>${escapeXML(m.name)}</NAME>
    <PARENT>${escapeXML(m.parent)}</PARENT>
    <OPENINGBALANCE>${m.openingBalance || "0.00"}</OPENINGBALANCE>
    <ISBILLWISEON>No</ISBILLWISEON>
    <ISDEDUCTEEON>No</ISDEDUCTEEON>
  </LEDGER>`).join("");

    const voucherXML = vouchers.map(v => `
  <VOUCHER VCHTYPE="${escapeXML(v.type)}" ACTION="CREATE">
    <DATE>${escapeXML(v.date)}</DATE>
    <VOUCHERNUMBER>${escapeXML(v.number)}</VOUCHERNUMBER>
    <NARRATION>${escapeXML(v.narration)}</NARRATION>
    ${(v.lines || []).map(l => `
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${escapeXML(l.ledgerName)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>${l.isDeemedPositive ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
      <AMOUNT>${l.isDeemedPositive ? "-" : ""}${Math.abs(l.amount).toFixed(2)}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>`).join("")}
  </VOUCHER>`).join("");

    return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>MySocietySuite</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          ${masterXML}
          ${voucherXML}
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`, "utf8");
}

// ── Excel generator ────────────────────────────────────────────────────────────
function generateExcel(reportType, data) {
    const wb = XLSX.utils.book_new();
    const sheets = buildSheets(reportType, data);
    for (const [sheetName, rows] of sheets) {
        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    }
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// ── CSV generator ──────────────────────────────────────────────────────────────
function generateCSV(reportType, data) {
    const sheets = buildSheets(reportType, data);
    // Use first sheet for CSV
    const [, rows] = sheets[0];
    const csv = rows.map(row =>
        row.map(cell => {
            const s = String(cell === null || cell === undefined ? "" : cell);
            return s.includes(",") || s.includes('"') || s.includes("\n")
                ? `"${s.replace(/"/g, '""')}"`
                : s;
        }).join(",")
    ).join("\r\n");
    return Buffer.from(csv, "utf8");
}

/** Build tabular rows for each report type (used by both Excel and CSV) */
function buildSheets(reportType, data) {
    switch (reportType) {
        case "DUES_AGEING":
            return [["Dues_Ageing", [
                ["Flat No", "Block", "Resident", "Is Defaulter", "Oldest Due Date", "Principal", "Fines", "Total Outstanding", "Current", "0-30 Days", "31-60 Days", "61-90 Days", "90+ Days"],
                ...(data.rows || []).map(r => [
                    r.flatNumber, r.blockName, r.residentName,
                    r.isDefaulter ? "Yes" : "No",
                    r.oldestDueDate,
                    r.outstanding.principal, r.outstanding.fines, r.outstanding.total,
                    r.buckets.current, r.buckets["0_30"], r.buckets["31_60"], r.buckets["61_90"], r.buckets["90_plus"],
                ]),
                ["", "", "", "", "TOTAL", data.totals?.principal, data.totals?.fines, data.totals?.outstanding],
            ]]];

        case "COLLECTIONS":
            return [["Collections", [
                ["Date", "Receipt No", "Flat", "Block", "Resident", "Invoice No", "Period", "Mode", "Bank Account", "Amount Paid", "Excess/Advance", "Reference"],
                ...(data.rows || []).map(r => [
                    r.paymentDate, r.receiptNumber, r.flatNumber, r.blockName, r.residentName,
                    r.invoiceNumber, r.billingPeriod, r.mode, r.bankAccount,
                    r.amountPaid, r.excessAmount, r.referenceNumber,
                ]),
                ["", "", "", "", "", "", "", "", "TOTAL", data.totals?.totalCollected],
            ]]];

        case "BALANCE_SHEET":
            return [["Balance_Sheet", flattenHierarchyToRows(data)]];

        case "PROFIT_LOSS":
            return [["Profit_Loss", flattenPLToRows(data)]];

        case "GST":
            return [["GST_Report", [
                ["Charge Head", "Code", "GST Rate %", "Taxable Value", "GST Collected", "CGST", "SGST", "IGST"],
                ...(data.rows || []).map(r => [
                    r.chargeHeadName, r.chargeHeadCode, r.gstRate,
                    r.taxableValue, r.gstCollected,
                    r.cgst || "", r.sgst || "", r.igst || "",
                ]),
                ["", "TOTAL", "", data.totals?.taxableValue, data.totals?.gstCollected],
            ]]];

        case "TDS":
            return [["TDS_Statement", [
                ["Vendor", "PAN", "TDS Category", "TDS Section", "TDS Rate %", "Gross Payment", "TDS Deducted", "Net Paid", "Payment Date", "Challan Ref"],
                ...(data.rows || []).map(r => [
                    r.vendorName, r.pan, r.tdsCategory, r.tdsSection, r.tdsRate,
                    r.grossAmount, r.tdsDeducted, r.netPaid, r.paymentDate, r.challanRef,
                ]),
                ["TOTAL", "", "", "", "", data.totals?.grossPayment, data.totals?.tdsDeducted, data.totals?.netPaid],
            ]]];

        default:
            return [["Data", [["Report data not available for type: " + reportType]]]];
    }
}

function flattenHierarchyToRows(bs) {
    const rows = [["Account Code", "Account Name", "Balance"]];
    const addSection = (label, accounts) => {
        rows.push([label, "", ""]);
        function addAccounts(accs, depth = 0) {
            for (const a of accs) {
                rows.push(["  ".repeat(depth) + a.accountCode, a.accountName, a.balance]);
                if (a.children?.length) addAccounts(a.children, depth + 1);
            }
        }
        addAccounts(accounts);
    };
    if (bs.sections?.assets)      addSection("ASSETS",      bs.sections.assets.accounts);
    if (bs.sections?.liabilities) addSection("LIABILITIES", bs.sections.liabilities.accounts);
    if (bs.sections?.equity)      addSection("EQUITY/FUNDS", bs.sections.equity.accounts);
    rows.push(["Current Period Surplus/(Deficit)", "", bs.sections?.currentPeriodSurplus?.amount]);
    rows.push(["", "Total Assets", bs.totals?.totalAssets]);
    rows.push(["", "Total Liabilities + Equity + Surplus", bs.totals?.totalLiabAndEquity]);
    rows.push(["", "Balance Check (should be 0.00)", bs.totals?.balanceCheck]);
    return rows;
}

function flattenPLToRows(pl) {
    const rows = [["Account Code", "Account Name", "Amount"]];
    function addAccounts(accs, depth = 0) {
        for (const a of accs) {
            rows.push(["  ".repeat(depth) + a.accountCode, a.accountName, a.balance]);
            if (a.children?.length) addAccounts(a.children, depth + 1);
        }
    }
    rows.push(["INCOME", "", ""]);
    addAccounts(pl.sections?.income?.accounts || []);
    rows.push(["Total Income", "", pl.sections?.income?.total]);
    rows.push(["EXPENSES", "", ""]);
    addAccounts(pl.sections?.expense?.accounts || []);
    rows.push(["Total Expenses", "", pl.sections?.expense?.total]);
    rows.push([pl.surplus?.label || "Surplus/(Deficit)", "", pl.surplus?.amount]);
    return rows;
}

// ── PDF generator (basic, using pdfkit) ────────────────────────────────────────
async function generatePDF(reportType, data) {
    return new Promise((resolve, reject) => {
        const doc    = new PDFDocument({ margin: 40, size: "A4" });
        const chunks = [];
        doc.on("data",  c => chunks.push(c));
        doc.on("end",   ()  => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        doc.fontSize(14).font("Helvetica-Bold").text(`MySocietySuite — ${reportType.replace(/_/g, " ")}`, { align: "center" });
        doc.moveDown(0.5);
        doc.fontSize(9).font("Helvetica").text(`Generated at: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`, { align: "center" });
        doc.moveDown(1);

        // Render based on type
        try {
            const sheets = buildSheets(reportType, data);
            const [, rows] = sheets[0];
            const header = rows[0];
            const colWidth = Math.max(50, (doc.page.width - 80) / header.length);
            rows.forEach((row, idx) => {
                // Header row and section headers (where cell 1 & 2 are empty) get bold
                if (idx === 0 || (!row[1] && !row[2])) doc.font("Helvetica-Bold");
                else doc.font("Helvetica");
                
                const startY = doc.y;
                let maxBottom = startY + doc.currentLineHeight();
                
                row.forEach((cell, ci) => {
                    const textStr = String(cell || "");
                    if (textStr) {
                        doc.text(textStr, 40 + ci * colWidth, startY, { width: colWidth - 2, lineBreak: false });
                        maxBottom = Math.max(maxBottom, doc.y);
                    }
                });
                
                doc.y = maxBottom;
                doc.moveDown(0.5);
                if (doc.y > doc.page.height - 60) doc.addPage();
            });
        } catch (e) {
            doc.fontSize(10).text(JSON.stringify(data, null, 2));
        }

        doc.end();
    });
}

// ── Tally / Invoice / Ledger data fetchers ─────────────────────────────────────

async function fetchTallyData(societyId, params, db) {
    const { ChartOfAccount, JournalEntry, JournalEntryLine } = getLedgerModels(db);
    const sid = new mongoose.Types.ObjectId(societyId);

    const fromDate = params.from ? new Date(params.from) : new Date(0);
    const toDate   = params.to   ? new Date(params.to)   : new Date();
    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);

    // Ledger masters (chart of accounts)
    const coa = await ChartOfAccount.find({ societyId: sid, status: "ACTIVE" })
        .sort({ accountCode: 1 })
        .lean();

    const tallyGroupMap = {
        ASSET:     "Current Assets",
        LIABILITY: "Current Liabilities",
        EQUITY:    "Reserves & Surplus",
        INCOME:    "Income",
        EXPENSE:   "Indirect Expenses",
    };

    const masters = coa.map(a => ({
        name:           a.accountName,
        parent:         tallyGroupMap[a.accountType] || "Current Assets",
        openingBalance: "0.00",
    }));

    // Vouchers (POSTED JEs in range)
    const jes = await JournalEntry.find({
        societyId: sid,
        status: "POSTED",
        postingDate: { $gte: fromDate, $lte: toDate },
    }).sort({ postingDate: 1, journalNumber: 1 }).lean();

    const jeIds = jes.map(j => j._id);
    const lines = await JournalEntryLine.find({ societyId: sid, journalId: { $in: jeIds } }).lean();
    const linesByJE = new Map();
    for (const l of lines) {
        const key = String(l.journalId);
        if (!linesByJE.has(key)) linesByJE.set(key, []);
        linesByJE.get(key).push(l);
    }

    // Map accountId → name
    const accById = new Map(coa.map(a => [String(a._id), a.accountName]));

    const voucherTypeMap = {
        INVOICE:          "Sales",
        PAYMENT:          "Receipt",
        EXPENSE:          "Payment",
        ADVANCE_RECEIVED: "Receipt",
        CREDIT_NOTE:      "Credit Note",
        DEBIT_NOTE:       "Debit Note",
        MANUAL:           "Journal",
        OPENING_BALANCE:  "Journal",
    };

    const vouchers = jes.map(je => {
        const jeLines = linesByJE.get(String(je._id)) || [];
        return {
            type:     voucherTypeMap[je.referenceType] || "Journal",
            date:     je.postingDate ? je.postingDate.toISOString().slice(0, 10).replace(/-/g, "") : "",
            number:   je.journalNumber,
            narration: je.description || "",
            lines: jeLines.map(l => ({
                ledgerName:       accById.get(String(l.accountId)) || "Unknown",
                isDeemedPositive: l.debit > 0,
                amount:           l.debit > 0 ? l.debit : l.credit,
            })),
        };
    });

    return { masters, vouchers };
}

async function fetchInvoicesData(societyId, params, db) {
    const { getBillingModels } = require("../billing/billing.model");
    const { BillingInvoice } = getBillingModels(db);
    const sid = new mongoose.Types.ObjectId(societyId);
    const fromDate = params.from ? new Date(params.from) : new Date(0);
    const toDate   = params.to   ? new Date(params.to)   : new Date();
    return BillingInvoice.find({
        societyId: sid,
        invoiceDate: { $gte: fromDate, $lte: toDate },
        status: { $nin: ["CANCELLED", "cancelled"] },
    }).sort({ invoiceDate: 1, invoiceNumber: 1 }).lean();
}

async function fetchLedgerMasters(societyId, db) {
    const { ChartOfAccount } = getLedgerModels(db);
    const sid = new mongoose.Types.ObjectId(societyId);
    return ChartOfAccount.find({ societyId: sid, status: "ACTIVE" }).sort({ accountCode: 1 }).lean();
}


/**
 * streamExport — generate a report file in memory and return it directly.
 * No S3, no tmp_exports, no ExportJob record.
 * The caller (controller) pipes buffer → res.
 */
async function streamExport(opts) {
    const { societyId, reportType, format, params, db } = opts;

    const validTypes   = ["BALANCE_SHEET","PROFIT_LOSS","GST","TDS","DUES_AGEING","COLLECTIONS","TALLY","INVOICES","LEDGER_MASTERS"];
    const validFormats = ["CSV","EXCEL","PDF","TALLY_XML"];
    if (!validTypes.includes(reportType))   throw new Error(`Invalid reportType: ${reportType}`);
    if (!validFormats.includes(format))     throw new Error(`Invalid format: ${format}`);

    const reportData = await fetchReportData(reportType, societyId, params, db);

    let buffer, contentType, extension;
    if (format === "TALLY_XML") {
        buffer      = generateTallyXML(reportData, { societyId, params });
        contentType = "application/xml";
        extension   = "xml";
    } else if (format === "EXCEL") {
        buffer      = generateExcel(reportType, reportData);
        contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        extension   = "xlsx";
    } else if (format === "CSV") {
        buffer      = generateCSV(reportType, reportData);
        contentType = "text/csv";
        extension   = "csv";
    } else if (format === "PDF") {
        buffer      = await generatePDF(reportType, reportData);
        contentType = "application/pdf";
        extension   = "pdf";
    }

    const slug     = reportType.toLowerCase().replace(/_/g, "-");
    const filename = `${slug}_${new Date().toISOString().split("T")[0]}.${extension}`;
    return { buffer, contentType, filename };
}

module.exports = {
    createExportJob,
    processExportJob,
    getDownloadUrl,
    computeParamsHash,
    streamExport,
};

