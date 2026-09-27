"use strict";

const AppError = require("../../common/AppError");
const { LedgerService, generateAutomaticPosting } = require("./ledger.service");
const { hasBillingPermission } = require("../../services/billingAuthorization.service");
const { BILLING_PERMISSIONS } = require("../../common/billingPermissions");
const { sendSuccess, sendError, sendPaginated } = require("../../utils/response.utils");

// ─── Helper: Derive opsDb from req ───────────────────────────────────────────
function getDb(req) {
    return req.opsDb;
}

function getSocietyId(req) {
    const sid = req.user?.societyId;
    if (!sid) throw new AppError("Society context is missing.", 400);
    return sid;
}

function getUserId(req) {
    return req.user?.id || req.user?._id;
}

function getUserRole(req) {
    return (req.user?.roleKeys || [req.user?.role]).join(",");
}

// ─── Ledger Controller ────────────────────────────────────────────────────────
const LedgerController = {

    // ── Overview ──────────────────────────────────────────────────────────────
    async getOverview(req, res, next) {
        try {
            const societyId = getSocietyId(req);
            const data = await LedgerService.getOverviewSummary(societyId, getDb(req), req.query);
            return sendSuccess(res, 200, "Ledger overview fetched.", data);
        } catch (err) { next(err); }
    },

    // ── Chart of Accounts ─────────────────────────────────────────────────────
    async getChartOfAccounts(req, res, next) {
        try {
            const societyId = getSocietyId(req);
            const accounts = await LedgerService.getChartOfAccounts(societyId, getDb(req), req.query);
            return sendSuccess(res, 200, "Chart of accounts fetched.", { accounts });
        } catch (err) { next(err); }
    },

    async createAccount(req, res, next) {
        try {
            const societyId = getSocietyId(req);
            const account = await LedgerService.createAccount(societyId, getUserId(req), req.body, getDb(req));
            return sendSuccess(res, 201, "Account created successfully.", { account });
        } catch (err) { next(err); }
    },

    async deactivateAccount(req, res, next) {
        try {
            const societyId = getSocietyId(req);
            const account = await LedgerService.deactivateAccount(societyId, getUserId(req), req.params.id, getDb(req));
            return sendSuccess(res, 200, "Account deactivated.", { account });
        } catch (err) { next(err); }
    },

    async seedChartOfAccounts(req, res, next) {
        try {
            const societyId = getSocietyId(req);
            const result = await LedgerService.seedDefaultChartOfAccounts(societyId, getUserId(req), getDb(req));
            if (result.alreadyExists) return sendSuccess(res, 200, "Chart of accounts already initialized.", result);
            return sendSuccess(res, 201, "Default chart of accounts seeded successfully.", result);
        } catch (err) { next(err); }
    },

    // ── General Ledger ────────────────────────────────────────────────────────
    async getGeneralLedger(req, res, next) {
        try {
            const societyId = getSocietyId(req);
            const { entries, meta } = await LedgerService.getGeneralLedgerLines(societyId, getDb(req), req.query);
            return sendPaginated(res, 200, "General ledger fetched.", entries, meta);
        } catch (err) { next(err); }
    },

    // ── My Ledger (Resident) ──────────────────────────────────────────────────
    async getMyLedger(req, res, next) {
        try {
            const societyId = getSocietyId(req);
            const residentId = getUserId(req);
            // Backend enforces: resident can only see their own ledger
            const { entries, meta } = await LedgerService.getResidentLedger(societyId, residentId, getDb(req), req.query);
            return sendPaginated(res, 200, "Your ledger statement fetched.", entries, meta);
        } catch (err) { next(err); }
    },

    // ── Account Statement ─────────────────────────────────────────────────────
    async getAccountStatement(req, res, next) {
        try {
            const societyId = getSocietyId(req);
            const statement = await LedgerService.getAccountStatement(societyId, req.params.accountId, getDb(req), req.query);
            return sendSuccess(res, 200, "Account statement fetched.", statement);
        } catch (err) { next(err); }
    },

    // ── Journal Entries ───────────────────────────────────────────────────────
    async listJournalEntries(req, res, next) {
        try {
            const societyId = getSocietyId(req);
            // Default to ALL so that drafts and pending approvals show up
            const query = { status: "ALL", ...req.query };
            const { entries, meta } = await LedgerService.getGeneralLedger(societyId, getDb(req), query);
            return sendPaginated(res, 200, "Journal entries fetched.", entries, meta);
        } catch (err) { next(err); }
    },

    async getJournalEntry(req, res, next) {
        try {
            const societyId = getSocietyId(req);
            const entry = await LedgerService.getJournalEntry(societyId, req.params.id, getDb(req));
            return sendSuccess(res, 200, "Journal entry fetched.", { entry });
        } catch (err) { next(err); }
    },

    async createJournalEntry(req, res, next) {
        try {
            const societyId = getSocietyId(req);
            const { description, transactionDate, lines, notes, referenceType } = req.body;
            if (!description) return next(new AppError("Description is required.", 400));
            if (!lines || !Array.isArray(lines) || lines.length < 2) {
                return next(new AppError("At least 2 journal entry lines are required.", 400));
            }

            const { journalEntry } = await LedgerService.postJournalEntry({
                societyId,
                userId:    getUserId(req),
                userRole:  getUserRole(req),
                description,
                transactionDate: transactionDate || new Date(),
                referenceType: referenceType || "MANUAL",
                lines,
                notes: notes || null,
                isAutomatic: false,
                db: getDb(req),
            });
            return sendSuccess(res, 201, "Journal entry created.", { journalEntry });
        } catch (err) { next(err); }
    },

    async submitJournalEntry(req, res, next) {
        try {
            const societyId = getSocietyId(req);
            const entry = await LedgerService.submitJournalEntry(societyId, getUserId(req), req.params.id, getDb(req));
            return sendSuccess(res, 200, "Journal entry submitted for approval.", { entry });
        } catch (err) { next(err); }
    },

    async approveJournalEntry(req, res, next) {
        try {
            const societyId = getSocietyId(req);
            const entry = await LedgerService.approveJournalEntry(societyId, getUserId(req), req.params.id, getDb(req));
            return sendSuccess(res, 200, "Journal entry approved.", { entry });
        } catch (err) { next(err); }
    },

    async postJournalEntry(req, res, next) {
        try {
            const societyId = getSocietyId(req);
            const entry = await LedgerService.postManualJournalEntry(societyId, getUserId(req), req.params.id, getDb(req));
            return sendSuccess(res, 200, "Journal entry posted to ledger.", { entry });
        } catch (err) { next(err); }
    },

    async rejectJournalEntry(req, res, next) {
        try {
            const societyId = getSocietyId(req);
            const { reason } = req.body;
            const entry = await LedgerService.rejectJournalEntry(societyId, getUserId(req), req.params.id, reason, getDb(req));
            return sendSuccess(res, 200, "Journal entry rejected.", { entry });
        } catch (err) { next(err); }
    },

    async reverseJournalEntry(req, res, next) {
        try {
            const societyId = getSocietyId(req);
            const { reason } = req.body;
            const reversal = await LedgerService.reverseJournalEntry(
                societyId, getUserId(req), getUserRole(req),
                req.params.id, reason, getDb(req)
            );
            return sendSuccess(res, 201, "Journal entry reversed successfully.", { reversal });
        } catch (err) { next(err); }
    },

    // ── Accounting Periods ────────────────────────────────────────────────────
    async getAccountingPeriods(req, res, next) {
        try {
            const societyId = getSocietyId(req);
            const periods = await LedgerService.getAccountingPeriods(societyId, getDb(req), req.query);
            return sendSuccess(res, 200, "Accounting periods fetched.", { periods });
        } catch (err) { next(err); }
    },

    async closePeriod(req, res, next) {
        try {
            const societyId = getSocietyId(req);
            const period = await LedgerService.closePeriod(societyId, getUserId(req), req.params.id, getDb(req));
            return sendSuccess(res, 200, "Accounting period closed.", { period });
        } catch (err) { next(err); }
    },

    async reopenPeriod(req, res, next) {
        try {
            const societyId = getSocietyId(req);
            const { reason } = req.body;
            const period = await LedgerService.reopenPeriod(societyId, getUserId(req), req.params.id, reason, getDb(req));
            return sendSuccess(res, 200, "Accounting period reopened.", { period });
        } catch (err) { next(err); }
    },

    // ── Audit Logs ────────────────────────────────────────────────────────────
    async getAuditLogs(req, res, next) {
        try {
            const societyId = getSocietyId(req);
            const { logs, meta } = await LedgerService.getAuditLogs(societyId, getDb(req), req.query);
            return sendPaginated(res, 200, "Ledger audit logs fetched.", logs, meta);
        } catch (err) { next(err); }
    },
};

module.exports = { LedgerController };
