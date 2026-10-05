"use strict";

const express = require("express");
const router = express.Router();

const authenticate = require("../../middleware/authenticate");
const injectSocietyId = require("../../middleware/injectSocietyId");
const checkPermission = require("../../middleware/checkPermission");
const { MODULES, PERMISSION_LEVELS } = require("../../common/constants");
const ctrl = require("./report.controller");

// ── Public: local file download (dev/self-hosted fallback) ────────────────────
// Must be registered BEFORE router.use(authenticate) — window.open() carries
// no Authorization header, so this route cannot be behind JWT auth.
// GET /reports/exports/local/:filename
router.get("/exports/local/:filename", ctrl.getExportLocalDownload);

// All routes below require authentication + society context
router.use(authenticate, injectSocietyId);

const requireReportAccess = checkPermission(
    [MODULES.REPORTS_DASHBOARD, MODULES.BILLING_ACCOUNTS],
    PERMISSION_LEVELS.MANAGE  // VIEW=1 < MANAGE=2 < FULL=3; residents have VIEW → 403
);

router.get("/settings", requireReportAccess, ctrl.getReportSettings);
router.patch("/settings", checkPermission(MODULES.REPORTS_DASHBOARD, PERMISSION_LEVELS.FULL), ctrl.updateReportSettings);

// GET /reports/balance-sheet?asOf=2026-03-31
router.get("/balance-sheet", requireReportAccess, ctrl.getBalanceSheet);

// GET /reports/profit-loss?from=2026-04-01&to=2026-09-30
router.get("/profit-loss", requireReportAccess, ctrl.getProfitLoss);

// GET /reports/gst?from=2026-04-01&to=2026-09-30
router.get("/gst", requireReportAccess, ctrl.getGSTReport);

// GET /reports/tds?from=2026-04-01&to=2026-09-30
router.get("/tds", requireReportAccess, ctrl.getTDSStatement);

// GET /reports/dues-ageing?asOf=2026-09-30&flat=...&block=A&bucket=31_60&defaulters=true
router.get("/dues-ageing", requireReportAccess, ctrl.getDuesAgeing);

// GET /reports/collections?from=...&to=...&flat=...&block=A&mode=UPI&account=...
router.get("/collections", requireReportAccess, ctrl.getCollections);

// POST /reports/exports/stream  — direct download, no S3, no polling
router.post("/exports/stream", requireReportAccess, ctrl.streamDownload);

// POST /reports/exports  { reportType, format, params }
router.post("/exports", requireReportAccess, ctrl.createExport);
// GET /reports/exports/:id
router.get("/exports/:id", requireReportAccess, ctrl.getExportJob);
// GET /reports/exports/:id/download  (signed URL; user-specific)
router.get("/exports/:id/download", requireReportAccess, ctrl.getExportDownload);

module.exports = router;
