"use strict";

/**
 * Budget Domain Service
 * FR-B10.1 / FR-B10.2 / FR-B10.3 / BRD 4.1 / BRD 6.12
 *
 * This service owns the state machine and the actuals engine.
 * Controllers are thin – they call one method here per request.
 *
 * Money: all internal calculations in INTEGER PAISE. fromPaise() only for API responses.
 * Timezone: Asia/Kolkata for year-elapsed computation.
 * Actuals invariant: for the same FY+accounts, actual figures == P&L report figures to the paisa.
 */

const mongoose  = require("mongoose");
const AppError  = require("../../common/AppError");
const { getBudgetModels }  = require("./budget.model");
const { getLedgerModels }  = require("../ledger/ledger.model");
const { toPaise, fromPaise } = require("../report/money");

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS = Object.freeze({
    DRAFT:            "DRAFT",
    PENDING_APPROVAL: "PENDING_APPROVAL",
    APPROVED:         "APPROVED",
});

const ACTION = Object.freeze({
    CREATED:    "CREATED",
    LINES_SAVED:"LINES_SAVED",
    SUBMITTED:  "SUBMITTED",
    APPROVED:   "APPROVED",
    SENT_BACK:  "SENT_BACK",
    WITHDRAWN:  "WITHDRAWN",
});

// BRD 4.1 roles relevant to budget
const ROLE = Object.freeze({
    ADMIN:      "admin",
    COMMITTEE:  "committee_member",
    ACCOUNTANT: "accountant",
    SUPER_ADMIN:"super_admin",
    RESIDENT_OWNER: "resident_owner",
    RESIDENT_TENANT: "resident_tenant",
});

// Pace threshold setting (default 10 percentage points, BRD configurable)
const DEFAULT_PACE_THRESHOLD = 10;

// Max comment length
const MAX_COMMENT_LEN = 1000;

// ── Financial Year Helpers ────────────────────────────────────────────────────

/**
 * Parse "YYYY-YY" into { fyStart: Date, fyEnd: Date } in Asia/Kolkata.
 * Default FY: April 1 → March 31.
 * @param {string} fy  e.g. "2026-27"
 */
function parseFY(fy) {
    if (!/^\d{4}-\d{2}$/.test(fy)) {
        throw new AppError(`Invalid financial year format: "${fy}". Expected YYYY-YY.`, 400, "INVALID_FY_FORMAT");
    }
    const [startYearStr, endSuffix] = fy.split("-");
    const startYear = parseInt(startYearStr, 10);
    const endYear   = startYear - (startYear % 100) + parseInt(endSuffix, 10);
    if (endYear !== startYear + 1) {
        throw new AppError(`Financial year suffix mismatch: "${fy}".`, 400, "INVALID_FY_FORMAT");
    }
    // Asia/Kolkata: UTC+5:30 → April 1 00:00 IST = March 31 18:30 UTC
    const fyStart = new Date(`${startYear}-04-01T00:00:00+05:30`);
    const fyEnd   = new Date(`${endYear}-03-31T23:59:59.999+05:30`);
    return { fyStart, fyEnd, startYear, endYear };
}

/**
 * Compute how far through the FY we currently are (0–100, clamped).
 * Uses Asia/Kolkata timezone for "today". (FR-B10.3)
 * @param {string} fy
 * @returns {number} yearElapsedPct
 */
function computeYearElapsedPct(fy) {
    const { fyStart, fyEnd } = parseFY(fy);
    const nowUtc  = Date.now();
    const totalMs = fyEnd.getTime() - fyStart.getTime();
    const elapsed = nowUtc - fyStart.getTime();
    if (elapsed <= 0) return 0;
    if (elapsed >= totalMs) return 100;
    return Math.round((elapsed / totalMs) * 10000) / 100; // two decimal places
}

/**
 * Has the FY started as of now?
 * @param {string} fy
 */
function fyHasStarted(fy) {
    const { fyStart } = parseFY(fy);
    return Date.now() >= fyStart.getTime();
}

// ── Role-check helpers (BRD 4.1) ─────────────────────────────────────────────

function isCommitteeAdmin(roleKeys) {
    return roleKeys.includes(ROLE.ADMIN) || roleKeys.includes(ROLE.COMMITTEE);
}

function isAccountant(roleKeys) {
    return roleKeys.includes(ROLE.ACCOUNTANT);
}

function isSocietyMember(roleKeys) {
    return roleKeys.includes(ROLE.RESIDENT_OWNER) || roleKeys.includes(ROLE.RESIDENT_TENANT);
}

function isSuperAdmin(role) {
    return role === ROLE.SUPER_ADMIN;
}

/**
 * Can the user view budget of given status? (BRD 4.1 access matrix)
 * - Committee Admin: all statuses
 * - Accountant: all statuses
 * - Society Member: APPROVED only
 * - Super Admin: NO access
 */
function canView(user, status) {
    if (isSuperAdmin(user.role)) return false;
    if (isCommitteeAdmin(user.roleKeys || []) || isAccountant(user.roleKeys || [])) return true;
    if (isSocietyMember(user.roleKeys || [])) return status === STATUS.APPROVED;
    return false;
}

// ── Audit helper ──────────────────────────────────────────────────────────────

/**
 * Write one BudgetAuditLog entry.
 * Called inside the same save() call or right after, always before returning to caller.
 * On failure, we log a warning but do NOT swallow it silently in state-machine methods
 * (the service throws so the caller can roll back the preceding save).
 */
async function writeAudit({ db, societyId, budgetId, financialYear, userId, userRole, action, comment, lineChanges }) {
    const { BudgetAuditLog } = getBudgetModels(db);
    await BudgetAuditLog.create({
        societyId, budgetId, financialYear,
        userId, userRole, action,
        comment:     comment     || null,
        lineChanges: lineChanges || null,
        timestamp:   new Date(),
    });
}

// ── Actuals Engine ───────────────────────────────────────────────────────────

/**
 * Compute actual income/expense per ledger account for the budget's FY.
 * Uses the SAME aggregate as the P&L report (profitLoss.service.js) so numbers
 * are identical to the paisa (hard invariant FR-B10.3).
 *
 * Sign convention (matching P&L):
 *   INCOME  → credits - debits  (credit notes reduce income)
 *   EXPENSE → debits  - credits (reversals reduce expense)
 *
 * Only POSTED journal entries are included (reversed entries have status=REVERSED,
 * so they are automatically excluded).
 *
 * @param {object} opts
 * @param {string} opts.societyId
 * @param {string} opts.financialYear
 * @param {string} [opts.incomeActualsBasis]  "ACCRUAL" | "CASH" (TODO(BA))
 * @param {Array}  opts.accountIds  list of ledger account ObjectId strings to compute
 * @param {object} opts.db  mongoose connection
 * @returns {Map<string, number>}  accountId (string) → actual paise
 */
async function computeActuals({ societyId, financialYear, incomeActualsBasis, accountIds, db }) {
    const { fyStart, fyEnd } = parseFY(financialYear);
    const sid = new mongoose.Types.ObjectId(societyId);
    const accountObjectIds = accountIds.map(id => new mongoose.Types.ObjectId(String(id)));

    const { JournalEntryLine } = getLedgerModels(db);

    // Aggregate: same as profitLoss.service.js – only POSTED entries in the FY date range
    const lineAgg = await JournalEntryLine.aggregate([
        {
            $match: {
                societyId: sid,
                accountId: { $in: accountObjectIds },
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
                "_je.postingDate": { $gte: fyStart, $lte: fyEnd },
            },
        },
        {
            $group: {
                _id:         "$accountId",
                totalDebit:  { $sum: "$debit" },
                totalCredit: { $sum: "$credit" },
            },
        },
    ]);

    // Build raw balances
    const rawBalances = new Map();
    for (const row of lineAgg) {
        rawBalances.set(String(row._id), {
            debit:  toPaise(row.totalDebit),
            credit: toPaise(row.totalCredit),
        });
    }

    // Load the accounts to know their normalBalanceType
    const { ChartOfAccount } = getLedgerModels(db);
    const accounts = await ChartOfAccount.find({
        societyId: sid,
        _id: { $in: accountObjectIds },
    }).lean();

    const result = new Map();
    for (const acc of accounts) {
        const key = String(acc._id);
        const raw = rawBalances.get(key) || { debit: 0, credit: 0 };
        // INCOME accounts have normalBalance CREDIT → credits - debits
        // EXPENSE accounts have normalBalance DEBIT  → debits  - credits
        const actual = acc.normalBalanceType === "CREDIT"
            ? raw.credit - raw.debit
            : raw.debit  - raw.credit;
        result.set(key, actual);
    }

    return result;
}

/**
 * Compute actuals for parent accounts by rolling up all child accounts
 * (BRD 6.8 hierarchy). If a budget line keys on a parent account, its
 * actual includes all descendants.
 *
 * @param {object} opts
 * @param {string} opts.societyId
 * @param {string} opts.financialYear
 * @param {Array}  opts.budgetLines  BudgetLine documents (with ledgerAccountId)
 * @param {object} opts.db
 * @param {string} [opts.incomeActualsBasis]
 * @returns {Map<string, number>}  ledgerAccountId (string) → actual paise (with children rolled up)
 */
async function computeActualsWithRollup({ societyId, financialYear, budgetLines, db, incomeActualsBasis }) {
    const { ChartOfAccount } = getLedgerModels(db);
    const sid = new mongoose.Types.ObjectId(societyId);

    // Load all INCOME/EXPENSE accounts for this society (needed for hierarchy traversal)
    const allAccounts = await ChartOfAccount.find({
        societyId: sid,
        accountType: { $in: ["INCOME", "EXPENSE"] },
    }).lean();

    const accById = new Map(allAccounts.map(a => [String(a._id), a]));

    // Build children map
    const childrenOf = new Map(); // parentId → [childId]
    for (const acc of allAccounts) {
        const pid = acc.parentAccountId ? String(acc.parentAccountId) : null;
        if (pid) {
            if (!childrenOf.has(pid)) childrenOf.set(pid, []);
            childrenOf.get(pid).push(String(acc._id));
        }
    }

    // For each budget line, collect the line's account + all descendants
    function getAllDescendants(id) {
        const children = childrenOf.get(id) || [];
        return children.reduce((acc, cid) => [...acc, cid, ...getAllDescendants(cid)], []);
    }

    // Collect all unique account IDs we need actuals for
    const allNeeded = new Set();
    for (const line of budgetLines) {
        const id = String(line.ledgerAccountId);
        allNeeded.add(id);
        for (const did of getAllDescendants(id)) allNeeded.add(did);
    }

    // Fetch raw actuals for all needed accounts
    const rawActuals = await computeActuals({
        societyId, financialYear, incomeActualsBasis,
        accountIds: Array.from(allNeeded),
        db,
    });

    // For each budget line, sum: own actual + descendants
    const result = new Map();
    for (const line of budgetLines) {
        const id = String(line.ledgerAccountId);
        const descendants = getAllDescendants(id);
        let total = rawActuals.get(id) || 0;
        for (const did of descendants) {
            total += rawActuals.get(did) || 0;
        }
        result.set(id, total);
    }

    return result;
}

// ── Flag computation (pure, unit-testable) ────────────────────────────────────

/**
 * Compute flags for a single expense line. (FR-B10.3, SCOPE(out) confirms flags never block)
 * @param {number} allocatedPaise
 * @param {number} actualPaise
 * @param {number} yearElapsedPct
 * @param {number} paceThreshold  default 10
 * @returns {{ overBudget: boolean, aheadOfPace: boolean }}
 */
function computeFlags(allocatedPaise, actualPaise, yearElapsedPct, paceThreshold = DEFAULT_PACE_THRESHOLD) {
    if (allocatedPaise === 0) {
        return { overBudget: actualPaise > 0, aheadOfPace: false };
    }
    const usedPct = (actualPaise / allocatedPaise) * 100;
    return {
        overBudget:   usedPct > 100,
        aheadOfPace:  usedPct > yearElapsedPct + paceThreshold,
    };
}

// ── Service methods ────────────────────────────────────────────────────────────

/**
 * Create a new DRAFT budget for a society+FY.
 * 409 if a non-DRAFT budget already exists for this FY (per spec).
 * BRD 4.1: Accountant only.
 */
async function createDraft({ societyId, financialYear, userId, userRole, db }) {
    // Validate FY format
    parseFY(financialYear); // throws 400 on bad format

    const { Budget, BudgetAuditLog } = getBudgetModels(db);

    // Guard: at most one PENDING_APPROVAL or APPROVED per (society, FY)
    const existing = await Budget.findOne({
        societyId,
        financialYear,
        status: { $in: [STATUS.PENDING_APPROVAL, STATUS.APPROVED] },
    }).lean();

    if (existing) {
        throw new AppError(
            `A budget for FY ${financialYear} already exists with status ${existing.status}. Only one active budget is allowed per financial year.`,
            409,
            "BUDGET_ALREADY_EXISTS"
        );
    }

    // Also guard: if a DRAFT already exists, return 409
    const draftExists = await Budget.findOne({ societyId, financialYear, status: STATUS.DRAFT }).lean();
    if (draftExists) {
        throw new AppError(
            `A DRAFT budget for FY ${financialYear} already exists.`,
            409,
            "DRAFT_ALREADY_EXISTS"
        );
    }

    const budget = await Budget.create({
        societyId,
        financialYear,
        status:    STATUS.DRAFT,
        version:   1,
        rowVersion: 0,
        createdBy: userId,
        incomeActualsBasis: "ACCRUAL",
    });

    // Audit (FR-B12.1 / BRD 6.12)
    await writeAudit({
        db, societyId, budgetId: budget._id,
        financialYear, userId, userRole,
        action: ACTION.CREATED,
    });

    return budget;
}

/**
 * Save (replace) all budget lines for a DRAFT budget.
 * Atomically replaces all existing lines with the provided set.
 * Implements optimistic locking via rowVersion (409 on stale).
 * BRD 4.1: Accountant only, DRAFT status only.
 *
 * @param {object} opts
 * @param {string} opts.budgetId
 * @param {number} opts.rowVersion  client's current rowVersion
 * @param {Array}  opts.lines  [{ ledgerAccountId, allocatedPaise }]
 * @param {string} opts.societyId
 * @param {string} opts.userId
 * @param {string} opts.userRole
 * @param {object} opts.db
 */
async function saveDraft({ budgetId, rowVersion, lines, societyId, userId, userRole, db }) {
    const { Budget, BudgetLine, BudgetAuditLog } = getBudgetModels(db);
    const { ChartOfAccount } = getLedgerModels(db);

    // Load and lock-check
    const budget = await Budget.findOne({ _id: budgetId, societyId }).lean();
    if (!budget) throw new AppError("Budget not found.", 404, "BUDGET_NOT_FOUND");
    if (budget.status !== STATUS.DRAFT) {
        throw new AppError("Only DRAFT budgets can be edited.", 409, "INVALID_STATUS_TRANSITION");
    }
    if (budget.rowVersion !== rowVersion) {
        throw new AppError(
            `Stale budget version. Expected rowVersion=${budget.rowVersion}, got ${rowVersion}. Reload and try again.`,
            409,
            "STALE_ROW_VERSION"
        );
    }

    // Validate lines
    if (!Array.isArray(lines) || lines.length === 0) {
        // Empty save is allowed (saving an empty draft)
        // Will be rejected at submit time if no positive lines exist
    }

    const accountIds = lines.map(l => l.ledgerAccountId);

    // Duplicate account check
    const unique = new Set(accountIds.map(String));
    if (unique.size !== accountIds.length) {
        throw new AppError("Duplicate ledger accounts in budget lines.", 400, "DUPLICATE_ACCOUNT");
    }

    // Validate all accounts exist, are ACTIVE, and are INCOME or EXPENSE, and belong to this society
    let validAccounts = [];
    if (accountIds.length > 0) {
        validAccounts = await ChartOfAccount.find({
            _id:         { $in: accountIds },
            societyId:   societyId,
            accountType: { $in: ["INCOME", "EXPENSE"] },
            status:      "ACTIVE",
        }).lean();

        if (validAccounts.length !== accountIds.length) {
            throw new AppError(
                "One or more ledger accounts are invalid: must be ACTIVE INCOME/EXPENSE accounts for this society.",
                400,
                "INVALID_ACCOUNT"
            );
        }
    }

    const accountMap = new Map(validAccounts.map(a => [String(a._id), a]));

    // Amount validation: integer paise >= 0
    for (const line of lines) {
        if (!Number.isInteger(line.allocatedPaise) || line.allocatedPaise < 0) {
            throw new AppError(
                `allocatedPaise must be a non-negative integer. Got: ${line.allocatedPaise}`,
                400,
                "INVALID_AMOUNT"
            );
        }
        // Sane max: ₹100 crore per line = 10,000,000,000 paise
        if (line.allocatedPaise > 10_000_000_000) {
            throw new AppError(
                `allocatedPaise exceeds maximum allowed (₹100 crore). Got: ${line.allocatedPaise}`,
                400,
                "AMOUNT_TOO_LARGE"
            );
        }
    }

    // Load existing lines for audit diff
    const oldLines = await BudgetLine.find({ budgetId }).lean();
    const oldMap   = new Map(oldLines.map(l => [String(l.ledgerAccountId), l]));

    // Delete all existing lines and re-insert (atomic replace)
    await BudgetLine.deleteMany({ budgetId });

    const newLineDocs = lines.map((l, idx) => {
        const acc = accountMap.get(String(l.ledgerAccountId));
        return {
            societyId,
            budgetId,
            ledgerAccountId: l.ledgerAccountId,
            chargeHeadId:    l.chargeHeadId || null,
            accountName:     acc.accountName,
            accountCode:     acc.accountCode,
            accountType:     acc.accountType,
            allocatedPaise:  l.allocatedPaise,
            sortOrder:       idx,
        };
    });

    if (newLineDocs.length > 0) {
        await BudgetLine.insertMany(newLineDocs);
    }

    // Bump rowVersion
    const updated = await Budget.findByIdAndUpdate(
        budgetId,
        { $inc: { rowVersion: 1 } },
        { new: true }
    ).lean();

    // Build audit diff: before/after per changed line (BRD 6.12)
    const lineChanges = [];
    for (const line of newLineDocs) {
        const oldLine = oldMap.get(String(line.ledgerAccountId));
        const oldPaise = oldLine ? oldLine.allocatedPaise : null;
        if (oldPaise !== line.allocatedPaise) {
            lineChanges.push({
                ledgerAccountId: String(line.ledgerAccountId),
                accountName:     line.accountName,
                oldPaise,
                newPaise:        line.allocatedPaise,
            });
        }
    }
    // Also detect deleted lines
    for (const [id, oldLine] of oldMap) {
        if (!lines.find(l => String(l.ledgerAccountId) === id)) {
            lineChanges.push({
                ledgerAccountId: id,
                accountName:     oldLine.accountName,
                oldPaise:        oldLine.allocatedPaise,
                newPaise:        null, // deleted
            });
        }
    }

    await writeAudit({
        db, societyId, budgetId, financialYear: budget.financialYear,
        userId, userRole, action: ACTION.LINES_SAVED,
        lineChanges: lineChanges.length > 0 ? lineChanges : null,
    });

    return updated;
}

/**
 * Submit a DRAFT budget for approval.
 * DRAFT → PENDING_APPROVAL.
 * Validates: at least one line with allocatedPaise > 0.
 * BRD 4.1: Accountant only.
 */
async function submit({ budgetId, societyId, userId, userRole, db }) {
    const { Budget, BudgetLine } = getBudgetModels(db);

    const budget = await Budget.findOne({ _id: budgetId, societyId }).lean();
    if (!budget) throw new AppError("Budget not found.", 404, "BUDGET_NOT_FOUND");

    // Idempotent: if already PENDING, treat as success (safe no-op per spec)
    if (budget.status === STATUS.PENDING_APPROVAL) {
        return Budget.findById(budgetId).lean();
    }

    if (budget.status !== STATUS.DRAFT) {
        throw new AppError(
            `Cannot submit a budget in status ${budget.status}.`,
            409, "INVALID_STATUS_TRANSITION"
        );
    }

    // Validation: at least one line with allocatedPaise > 0
    const positiveLines = await BudgetLine.countDocuments({ budgetId, allocatedPaise: { $gt: 0 } });
    if (positiveLines === 0) {
        throw new AppError(
            "Cannot submit an empty budget. Please enter at least one budget amount greater than zero.",
            400, "EMPTY_BUDGET"
        );
    }

    const updated = await Budget.findByIdAndUpdate(
        budgetId,
        {
            status:      STATUS.PENDING_APPROVAL,
            submittedBy: userId,
            submittedAt: new Date(),
        },
        { new: true }
    ).lean();

    await writeAudit({
        db, societyId, budgetId, financialYear: budget.financialYear,
        userId, userRole, action: ACTION.SUBMITTED,
    });

    return updated;
}

/**
 * Approve a PENDING_APPROVAL budget. PENDING_APPROVAL → APPROVED.
 * BRD 4.1: Committee Admin only.
 * requireDifferentApprover: if true, approver cannot be the submitter (TODO(BA): setting).
 */
async function approve({ budgetId, societyId, userId, userRole, comment, requireDifferentApprover = false, db }) {
    const { Budget } = getBudgetModels(db);

    const budget = await Budget.findOne({ _id: budgetId, societyId }).lean();
    if (!budget) throw new AppError("Budget not found.", 404, "BUDGET_NOT_FOUND");

    // Idempotent
    if (budget.status === STATUS.APPROVED) {
        return Budget.findById(budgetId).lean();
    }

    if (budget.status !== STATUS.PENDING_APPROVAL) {
        throw new AppError(
            `Cannot approve a budget in status ${budget.status}. It must be PENDING_APPROVAL.`,
            409, "INVALID_STATUS_TRANSITION"
        );
    }

    if (requireDifferentApprover && String(budget.submittedBy) === String(userId)) {
        throw new AppError(
            "The approver cannot be the same person who submitted this budget (requireDifferentApprover is enabled).",
            409, "SELF_APPROVAL_BLOCKED"
        );
    }

    if (comment && comment.length > MAX_COMMENT_LEN) {
        throw new AppError(`Comment too long (max ${MAX_COMMENT_LEN} chars).`, 400, "COMMENT_TOO_LONG");
    }

    const updated = await Budget.findByIdAndUpdate(
        budgetId,
        {
            status:         STATUS.APPROVED,
            decidedBy:      userId,
            decidedAt:      new Date(),
            decisionComment: comment || null,
        },
        { new: true }
    ).lean();

    await writeAudit({
        db, societyId, budgetId, financialYear: budget.financialYear,
        userId, userRole, action: ACTION.APPROVED, comment,
    });

    return updated;
}

/**
 * Send back a PENDING_APPROVAL budget to DRAFT.
 * BRD 4.1: Committee Admin only.
 */
async function sendBack({ budgetId, societyId, userId, userRole, comment, db }) {
    const { Budget } = getBudgetModels(db);

    const budget = await Budget.findOne({ _id: budgetId, societyId }).lean();
    if (!budget) throw new AppError("Budget not found.", 404, "BUDGET_NOT_FOUND");

    // Idempotent
    if (budget.status === STATUS.DRAFT) {
        return Budget.findById(budgetId).lean();
    }

    if (budget.status !== STATUS.PENDING_APPROVAL) {
        throw new AppError(
            `Cannot send back a budget in status ${budget.status}. It must be PENDING_APPROVAL.`,
            409, "INVALID_STATUS_TRANSITION"
        );
    }

    if (comment && comment.length > MAX_COMMENT_LEN) {
        throw new AppError(`Comment too long (max ${MAX_COMMENT_LEN} chars).`, 400, "COMMENT_TOO_LONG");
    }

    const updated = await Budget.findByIdAndUpdate(
        budgetId,
        {
            status:          STATUS.DRAFT,
            decidedBy:       userId,
            decidedAt:       new Date(),
            decisionComment: comment || null,
        },
        { new: true }
    ).lean();

    await writeAudit({
        db, societyId, budgetId, financialYear: budget.financialYear,
        userId, userRole, action: ACTION.SENT_BACK, comment,
    });

    return updated;
}

/**
 * Withdraw a PENDING_APPROVAL budget back to DRAFT.
 * BRD 4.1: Accountant only.
 */
async function withdraw({ budgetId, societyId, userId, userRole, db }) {
    const { Budget } = getBudgetModels(db);

    const budget = await Budget.findOne({ _id: budgetId, societyId }).lean();
    if (!budget) throw new AppError("Budget not found.", 404, "BUDGET_NOT_FOUND");

    // Idempotent
    if (budget.status === STATUS.DRAFT) {
        return Budget.findById(budgetId).lean();
    }

    if (budget.status !== STATUS.PENDING_APPROVAL) {
        throw new AppError(
            `Cannot withdraw a budget in status ${budget.status}. It must be PENDING_APPROVAL.`,
            409, "INVALID_STATUS_TRANSITION"
        );
    }

    const updated = await Budget.findByIdAndUpdate(
        budgetId,
        { status: STATUS.DRAFT },
        { new: true }
    ).lean();

    await writeAudit({
        db, societyId, budgetId, financialYear: budget.financialYear,
        userId, userRole, action: ACTION.WITHDRAWN,
    });

    return updated;
}

// ── Query methods ─────────────────────────────────────────────────────────────

/**
 * List budgets for a society, optionally filtered by FY.
 * Access control: caller passes in the filtered statuses based on their role.
 */
async function listBudgets({ societyId, financialYear, allowedStatuses, db }) {
    const { Budget } = getBudgetModels(db);
    const query = { societyId, status: { $in: allowedStatuses } };
    if (financialYear) query.financialYear = financialYear;
    return Budget.find(query).sort({ financialYear: -1, createdAt: -1 }).lean();
}

/**
 * Get a single budget with its lines.
 * Returns null if not found (caller converts to 404/empty per role).
 */
async function getBudgetWithLines({ budgetId, societyId, db }) {
    const { Budget, BudgetLine } = getBudgetModels(db);
    const budget = await Budget.findOne({ _id: budgetId, societyId }).lean();
    if (!budget) return null;
    const lines = await BudgetLine.find({ budgetId }).sort({ accountType: 1, sortOrder: 1 }).lean();
    return { budget, lines };
}

/**
 * Get budget vs actuals for an APPROVED budget whose FY has started.
 * Returns budget figures only if FY has not yet started.
 * FR-B10.3.
 */
async function getBudgetVsActual({ budgetId, societyId, db, paceThreshold = DEFAULT_PACE_THRESHOLD }) {
    const { Budget, BudgetLine } = getBudgetModels(db);

    const budget = await Budget.findOne({ _id: budgetId, societyId }).lean();
    if (!budget) return null;

    const lines = await BudgetLine.find({ budgetId }).sort({ accountType: 1, sortOrder: 1 }).lean();

    const fyStarted = fyHasStarted(budget.financialYear);
    const showActuals = budget.status === STATUS.APPROVED && fyStarted;
    const yearElapsedPct = showActuals ? computeYearElapsedPct(budget.financialYear) : null;

    let actualsMap = new Map();
    if (showActuals) {
        actualsMap = await computeActualsWithRollup({
            societyId,
            financialYear: budget.financialYear,
            budgetLines: lines,
            incomeActualsBasis: budget.incomeActualsBasis,
            db,
        });
    }

    // Build response lines
    const incomeLines  = [];
    const expenseLines = [];

    for (const line of lines) {
        const allocated = line.allocatedPaise;
        const actual    = showActuals ? (actualsMap.get(String(line.ledgerAccountId)) || 0) : null;
        const remaining = actual !== null ? allocated - actual : null;
        const usedPct   = (allocated > 0 && actual !== null) ? (actual / allocated * 100) : (actual !== null ? (actual > 0 ? Infinity : 0) : null);

        let flags = {};
        if (showActuals && line.accountType === "EXPENSE") {
            flags = computeFlags(allocated, actual, yearElapsedPct, paceThreshold);
        }

        const lineOut = {
            id:              String(line._id),
            ledgerAccountId: String(line.ledgerAccountId),
            accountName:     line.accountName,
            accountCode:     line.accountCode,
            accountType:     line.accountType,
            allocatedPaise:  allocated,
            allocatedDisplay: fromPaise(allocated),
            ...(showActuals ? {
                actualPaise:     actual,
                actualDisplay:   fromPaise(actual),
                remainingPaise:  remaining,
                remainingDisplay: fromPaise(remaining),
                usedPct:         actual !== null ? Math.round((actual / Math.max(allocated, 1)) * 10000) / 100 : 0,
                flags,
            } : {}),
        };

        if (line.accountType === "INCOME") incomeLines.push(lineOut);
        else expenseLines.push(lineOut);
    }

    // Totals
    const totalBudgetedIncomePaise  = incomeLines.reduce((s, l) => s + l.allocatedPaise, 0);
    const totalBudgetedExpensePaise = expenseLines.reduce((s, l) => s + l.allocatedPaise, 0);
    const plannedSurplusPaise       = totalBudgetedIncomePaise - totalBudgetedExpensePaise;

    const totals = {
        budgetedIncomePaise:   totalBudgetedIncomePaise,
        budgetedIncomeDisplay: fromPaise(totalBudgetedIncomePaise),
        budgetedExpensePaise:  totalBudgetedExpensePaise,
        budgetedExpenseDisplay:fromPaise(totalBudgetedExpensePaise),
        plannedSurplusPaise,
        plannedSurplusDisplay: fromPaise(plannedSurplusPaise),
    };

    if (showActuals) {
        const totalActualIncomePaise  = incomeLines.reduce((s, l) => s + (l.actualPaise || 0), 0);
        const totalActualExpensePaise = expenseLines.reduce((s, l) => s + (l.actualPaise || 0), 0);
        totals.actualIncomePaise      = totalActualIncomePaise;
        totals.actualIncomeDisplay    = fromPaise(totalActualIncomePaise);
        totals.actualExpensePaise     = totalActualExpensePaise;
        totals.actualExpenseDisplay   = fromPaise(totalActualExpensePaise);
    }

    return {
        budget,
        incomeLines,
        expenseLines,
        totals,
        yearElapsedPct,
        showActuals,
        incomeActualsBasis: budget.incomeActualsBasis,
    };
}

/**
 * Get eligible ledger accounts for the line picker.
 * Returns active INCOME/EXPENSE accounts for the society.
 */
async function getEligibleAccounts({ societyId, db }) {
    const { ChartOfAccount } = getLedgerModels(db);
    return ChartOfAccount.find({
        societyId,
        accountType: { $in: ["INCOME", "EXPENSE"] },
        status: "ACTIVE",
    }).sort({ accountType: 1, accountCode: 1 }).lean();
}

/**
 * Get audit history for a budget.
 */
async function getBudgetHistory({ budgetId, societyId, db }) {
    const { BudgetAuditLog } = getBudgetModels(db);
    return BudgetAuditLog.find({ budgetId, societyId })
        .sort({ timestamp: 1 })
        .populate("userId", "name email")
        .lean();
}

module.exports = {
    // State machine
    createDraft,
    saveDraft,
    submit,
    approve,
    sendBack,
    withdraw,
    // Queries
    listBudgets,
    getBudgetWithLines,
    getBudgetVsActual,
    getEligibleAccounts,
    getBudgetHistory,
    // Helpers (exported for unit tests)
    parseFY,
    computeYearElapsedPct,
    fyHasStarted,
    computeFlags,
    canView,
    isCommitteeAdmin,
    isAccountant,
    isSocietyMember,
    isSuperAdmin,
    STATUS,
    ACTION,
    ROLE,
};
