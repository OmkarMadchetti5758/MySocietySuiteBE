"use strict";

const AppError = require("../../common/AppError");
const { sendSuccess, sendPaginated } = require("../../utils/response.utils");

const { getDuesAgeing } = require("./dues.service");
const { getCollections } = require("./collections.service");
const { getBalanceSheet } = require("./balanceSheet.service");
const { getProfitLoss } = require("./profitLoss.service");
const { getGSTReport } = require("./gst.service");
const { getTDSStatement } = require("./tds.service");
const { createExportJob, processExportJob, getDownloadUrl, streamExport } = require("./export.service");
const { getReportModels } = require("./report.model");
const { ReportSettingsService } = require("./reportSettings.service");
const { logBillingAction } = require("../../services/billingAudit.service");

function parseDate(str, label) {
    if (!str) return null;
    const d = new Date(str);
    if (isNaN(d.getTime())) throw new AppError(`Invalid date for ${label}: "${str}"`, 400, "INVALID_DATE");
    return d;
}

function parseDateRange(req) {
    const from = parseDate(req.query.from, "from");
    const to = parseDate(req.query.to, "to");
    if (from && to && from > to) {
        throw new AppError("'from' date must be on or before 'to' date.", 400, "INVALID_DATE_RANGE");
    }
    return { from, to };
}

function parseAsOf(req) {
    const asOf = req.query.asOf || new Date().toISOString().split("T")[0];
    return parseDate(asOf, "asOf");
}

exports.getReportSettings = async (req, res, next) => {
    try {
        const settings = await ReportSettingsService.getSettings(req.societyId, req.opsDb);
        return sendSuccess(res, 200, "Report settings retrieved.", { settings });
    } catch (err) {
        next(err);
    }
};

exports.updateReportSettings = async (req, res, next) => {
    try {
        const settings = await ReportSettingsService.updateSettings(
            req.societyId, req.user.id, req.body, req.opsDb
        );
        return sendSuccess(res, 200, "Report settings updated.", { settings });
    } catch (err) {
        next(err);
    }
};

exports.getBalanceSheet = async (req, res, next) => {
    try {
        const asOf = parseAsOf(req);
        const result = await getBalanceSheet({
            societyId: req.societyId,
            asOf,
            db: req.opsDb,
        });
        return sendSuccess(res, 200, "Balance sheet retrieved.", result);
    } catch (err) {
        next(err);
    }
};

exports.getProfitLoss = async (req, res, next) => {
    try {
        const { from, to } = parseDateRange(req);
        const result = await getProfitLoss({
            societyId: req.societyId,
            from, to,
            db: req.opsDb,
        });
        return sendSuccess(res, 200, "Income & expense report retrieved.", result);
    } catch (err) {
        next(err);
    }
};

exports.getGSTReport = async (req, res, next) => {
    try {
        const { from, to } = parseDateRange(req);
        const result = await getGSTReport({
            societyId: req.societyId,
            from, to,
            db: req.opsDb,
        });
        return sendSuccess(res, 200, "GST report retrieved.", result);
    } catch (err) {
        next(err);
    }
};

exports.getTDSStatement = async (req, res, next) => {
    try {
        const { from, to } = parseDateRange(req);

        const page = parseInt(req.query.page || "1", 10);
        const pageSize = parseInt(req.query.pageSize || "50", 10);

        const result = await getTDSStatement({
            societyId: req.societyId,
            from, to,
            fullPAN: false, // UI always masked — FR-B11 D invariant
            page, pageSize,
            db: req.opsDb,
        });
        return sendPaginated(res, 200, "TDS statement retrieved.", result.rows, {
            ...result.meta,
            vendorSummary: result.vendorSummary,
            totals: result.totals,
            period: result.period,
            generatedAt: result.generatedAt,
        });
    } catch (err) {
        next(err);
    }
};

exports.getDuesAgeing = async (req, res, next) => {
    try {
        const asOf = parseAsOf(req);
        const page = parseInt(req.query.page || "1", 10);
        const pageSize = parseInt(req.query.pageSize || "50", 10);

        const result = await getDuesAgeing({
            societyId: req.societyId,
            asOf,
            flatId: req.query.flat || undefined,
            block: req.query.block || undefined,
            bucket: req.query.bucket || undefined,
            defaultersOnly: req.query.defaulters === "true",
            page, pageSize,
            db: req.opsDb,
        });
        return sendPaginated(res, 200, "Dues/ageing report retrieved.", result.rows, {
            ...result.meta,
            totals: result.totals,
            reconciliation: result.reconciliation,
            asOf: result.asOf,
            ageingBasis: result.ageingBasis,
            generatedAt: result.generatedAt,
        });
    } catch (err) {
        next(err);
    }
};

exports.getCollections = async (req, res, next) => {
    try {
        const { from, to } = parseDateRange(req);
        const page = parseInt(req.query.page || "1", 10);
        const pageSize = parseInt(req.query.pageSize || "50", 10);

        const result = await getCollections({
            societyId: req.societyId,
            from, to,
            flatId: req.query.flat || undefined,
            block: req.query.block || undefined,
            mode: req.query.mode || undefined,
            accountId: req.query.account || undefined,
            page, pageSize,
            db: req.opsDb,
        });
        return sendPaginated(res, 200, "Collection report retrieved.", result.rows, {
            ...result.meta,
            totals: result.totals,
            reconciliation: result.reconciliation,
            period: result.period,
            generatedAt: result.generatedAt,
        });
    } catch (err) {
        next(err);
    }
};

exports.createExport = async (req, res, next) => {
    try {
        const { reportType, format, params } = req.body;

        if (!reportType || !format) {
            return next(new AppError("reportType and format are required.", 400, "MISSING_PARAMS"));
        }

        const validTypes = ["BALANCE_SHEET", "PROFIT_LOSS", "GST", "TDS", "DUES_AGEING", "COLLECTIONS", "TALLY", "LEDGER_MASTERS", "INVOICES"];
        const validFormats = ["CSV", "EXCEL", "PDF", "TALLY_XML"];

        if (!validTypes.includes(reportType)) {
            return next(new AppError(`Invalid reportType. Allowed: ${validTypes.join(", ")}`, 400, "INVALID_REPORT_TYPE"));
        }
        if (!validFormats.includes(format)) {
            return next(new AppError(`Invalid format. Allowed: ${validFormats.join(", ")}`, 400, "INVALID_FORMAT"));
        }

        const { job, created } = await createExportJob({
            societyId: req.societyId,
            requestedBy: req.user.id,
            reportType,
            format,
            params: params || {},
            db: req.opsDb,
        });

        // Log export request to AuditLog (FR-B12.2 — append-only)
        try {
            await logBillingAction({
                req,
                action: "EXPORT_REQUESTED",
                resource: "REPORT",
                status: "SUCCESS",
                details: { reportType, format, params: params || {}, jobId: job._id, idempotent: !created },
            });
        } catch (_) { }

        // Kick off processing in background (non-blocking)
        if (created) {
            setImmediate(async () => {
                try {
                    const { getOperationsConnection } = require("../../config/operationsDb");
                    await processExportJob(job._id, getOperationsConnection());
                } catch (err) {
                    console.error("[EXPORT WORKER] Job failed:", job._id, err.message);
                }
            });
        }

        return sendSuccess(
            res, created ? 202 : 200,
            created ? "Export job created. Poll status to download." : "Existing export job returned.",
            { job: sanitiseJob(job) }
        );
    } catch (err) {
        next(err);
    }
};

exports.getExportJob = async (req, res, next) => {
    try {
        const { ExportJob } = getReportModels(req.opsDb);
        const job = await ExportJob.findOne({
            _id: req.params.id,
            societyId: req.societyId,
            // Invariant k: user can only get their own job (or admin sees all)
            ...(req.user.role !== "admin" && req.user.role !== "accountant"
                ? { requestedBy: req.user.id }
                : {}),
        }).lean();

        if (!job) return next(new AppError("Export job not found.", 404, "NOT_FOUND"));

        return sendSuccess(res, 200, "Export job retrieved.", { job: sanitiseJob(job) });
    } catch (err) {
        next(err);
    }
};

exports.getExportDownload = async (req, res, next) => {
    try {
        const { ExportJob } = getReportModels(req.opsDb);
        const job = await ExportJob.findOne({
            _id: req.params.id,
            societyId: req.societyId,
            requestedBy: req.user.id, // Invariant k: user-specific download only
        }).lean();

        if (!job) return next(new AppError("Export job not found.", 404, "NOT_FOUND"));
        if (job.status !== "DONE") {
            return next(new AppError(`Export not ready (status: ${job.status}).`, 409, "JOB_NOT_DONE"));
        }

        const url = await getDownloadUrl(job);
        if (!url) return next(new AppError("Download URL could not be generated.", 500, "URL_GEN_FAILED"));

        // Log download to AuditLog (FR-B12.2)
        try {
            await logBillingAction({
                req,
                action: "EXPORT_DOWNLOADED",
                resource: "REPORT",
                status: "SUCCESS",
                details: { jobId: job._id, reportType: job.reportType, format: job.format },
            });
        } catch (_) { }

        return sendSuccess(res, 200, "Download URL generated.", {
            downloadUrl: url,
            expiresIn: "15 minutes",
            format: job.format,
            reportType: job.reportType,
        });
    } catch (err) {
        next(err);
    }
};

exports.getExportLocalDownload = (req, res, next) => {
    try {
        const path = require("path");
        const fs = require("fs");
        
        // Sanitize filename to prevent directory traversal
        const filename = path.basename(req.params.filename);
        const filePath = path.join(process.cwd(), "tmp_exports", filename);

        if (!fs.existsSync(filePath)) {
            return next(new AppError("File not found or expired.", 404));
        }

        res.download(filePath, filename);
    } catch (err) {
        next(err);
    }
};

/** Strip internal fields before sending job to client */
function sanitiseJob(job) {
    const { downloadUrl, downloadUrlExpiresAt, paramsHash, s3Key, ...safe } = job;
    return safe;
}

/**
 * POST /reports/exports/stream
 * Body: { reportType, format, params }
 *
 * Generates the report file in memory and streams it directly as a
 * file download — no S3, no tmp folder, no polling required.
 */
exports.streamDownload = async (req, res, next) => {
    try {
        const { reportType, format, params = {} } = req.body;

        if (!reportType || !format) {
            return next(new AppError("reportType and format are required.", 400, "MISSING_PARAMS"));
        }

        const { buffer, contentType, filename } = await streamExport({
            societyId: req.societyId,
            reportType,
            format,
            params,
            db: req.opsDb,
        });

        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Length", buffer.length);
        res.end(buffer);
    } catch (err) {
        next(err);
    }
};
