"use strict";

/**
 * Budget Controller – thin HTTP layer.
 * All business logic lives in budget.service.js.
 * BRD 4.1 access control enforced here (role check per endpoint).
 */

const AppError   = require("../../common/AppError");
const { sendSuccess } = require("../../utils/response.utils");
const svc = require("./budget.service");

// ── Access Control Guard ──────────────────────────────────────────────────────

/**
 * Derive role-keys array from req.user (consistent with injectSocietyId pattern).
 */
function getRoleKeys(req) {
    return req.user?.roleKeys || (req.user?.role ? [req.user.role] : []);
}

function assertNotSuperAdmin(req, next) {
    if (svc.isSuperAdmin(req.user?.role)) {
        return next(new AppError("Super Admin does not have access to budget management.", 403, "ACCESS_DENIED"));
    }
}

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * GET /budgets?financialYear=
 * Lists budgets. Role-filtered:
 *  - Committee Admin / Accountant: all statuses
 *  - Society Member: APPROVED only
 *  - Super Admin: 403
 */
async function listBudgets(req, res, next) {
    try {
        const roleKeys = getRoleKeys(req);
        if (svc.isSuperAdmin(req.user?.role)) {
            return next(new AppError("Super Admin does not have access to budgets.", 403, "ACCESS_DENIED"));
        }

        let allowedStatuses;
        if (svc.isCommitteeAdmin(roleKeys) || svc.isAccountant(roleKeys)) {
            allowedStatuses = [svc.STATUS.DRAFT, svc.STATUS.PENDING_APPROVAL, svc.STATUS.APPROVED];
        } else if (svc.isSocietyMember(roleKeys)) {
            allowedStatuses = [svc.STATUS.APPROVED];
        } else {
            return next(new AppError("You do not have permission to view budgets.", 403, "ACCESS_DENIED"));
        }

        const budgets = await svc.listBudgets({
            societyId:     req.societyId,
            financialYear: req.query.financialYear || null,
            allowedStatuses,
            db: req.opsDb,
        });

        return sendSuccess(res, 200, "Budgets fetched successfully.", { budgets });
    } catch (err) {
        next(err);
    }
}

/**
 * POST /budgets
 * Create a DRAFT budget. BRD 4.1: Accountant only.
 */
async function createBudget(req, res, next) {
    try {
        const roleKeys = getRoleKeys(req);
        if (!svc.isAccountant(roleKeys)) {
            return next(new AppError("Only an Accountant can create a budget draft.", 403, "ACCESS_DENIED"));
        }

        const budget = await svc.createDraft({
            societyId:     req.societyId,
            financialYear: req.body.financialYear,
            userId:        req.user.id,
            userRole:      req.user.role,
            db:            req.opsDb,
        });

        return sendSuccess(res, 201, "Budget draft created.", { budget });
    } catch (err) {
        next(err);
    }
}

/**
 * GET /budgets/:id
 * Get budget + lines. Access-control per role.
 */
async function getBudget(req, res, next) {
    try {
        const roleKeys = getRoleKeys(req);
        if (svc.isSuperAdmin(req.user?.role)) {
            return next(new AppError("Super Admin does not have access to budgets.", 403, "ACCESS_DENIED"));
        }

        const result = await svc.getBudgetWithLines({
            budgetId:  req.params.id,
            societyId: req.societyId,
            db:        req.opsDb,
        });

        // 404 or empty for Society Members who cannot see non-APPROVED budgets
        if (!result) {
            return next(new AppError("Budget not found.", 404, "BUDGET_NOT_FOUND"));
        }

        const canSee = svc.canView(req.user, result.budget.status);
        if (!canSee) {
            // Do NOT leak existence – return 404 (BRD 4.1)
            return next(new AppError("Budget not found.", 404, "BUDGET_NOT_FOUND"));
        }

        return sendSuccess(res, 200, "Budget fetched.", result);
    } catch (err) {
        next(err);
    }
}

/**
 * GET /budgets/:id/vs-actual
 * Budget vs actuals. APPROVED + FY started required for actuals. (FR-B10.3)
 * Society Members can only see APPROVED.
 */
async function getBudgetVsActual(req, res, next) {
    try {
        const roleKeys = getRoleKeys(req);
        if (svc.isSuperAdmin(req.user?.role)) {
            return next(new AppError("Super Admin does not have access to budgets.", 403, "ACCESS_DENIED"));
        }

        const result = await svc.getBudgetVsActual({
            budgetId:  req.params.id,
            societyId: req.societyId,
            db:        req.opsDb,
        });

        if (!result) {
            return next(new AppError("Budget not found.", 404, "BUDGET_NOT_FOUND"));
        }

        if (!svc.canView(req.user, result.budget.status)) {
            return next(new AppError("Budget not found.", 404, "BUDGET_NOT_FOUND"));
        }

        return sendSuccess(res, 200, "Budget vs actuals fetched.", result);
    } catch (err) {
        next(err);
    }
}

/**
 * PUT /budgets/:id/lines
 * Save draft lines. BRD 4.1: Accountant only.
 */
async function saveLines(req, res, next) {
    try {
        const roleKeys = getRoleKeys(req);
        if (!svc.isAccountant(roleKeys)) {
            return next(new AppError("Only an Accountant can edit budget lines.", 403, "ACCESS_DENIED"));
        }

        const { rowVersion, lines } = req.body;

        const updated = await svc.saveDraft({
            budgetId:   req.params.id,
            rowVersion: Number(rowVersion),
            lines:      lines || [],
            societyId:  req.societyId,
            userId:     req.user.id,
            userRole:   req.user.role,
            db:         req.opsDb,
        });

        return sendSuccess(res, 200, "Budget lines saved.", { budget: updated });
    } catch (err) {
        next(err);
    }
}

/**
 * POST /budgets/:id/submit
 * Submit for approval. BRD 4.1: Accountant only.
 */
async function submitBudget(req, res, next) {
    try {
        const roleKeys = getRoleKeys(req);
        if (!svc.isAccountant(roleKeys)) {
            return next(new AppError("Only an Accountant can submit a budget for approval.", 403, "ACCESS_DENIED"));
        }

        const updated = await svc.submit({
            budgetId:  req.params.id,
            societyId: req.societyId,
            userId:    req.user.id,
            userRole:  req.user.role,
            db:        req.opsDb,
        });

        return sendSuccess(res, 200, "Budget submitted for approval.", { budget: updated });
    } catch (err) {
        next(err);
    }
}

/**
 * POST /budgets/:id/approve
 * Approve. BRD 4.1: Committee Admin only.
 */
async function approveBudget(req, res, next) {
    try {
        const roleKeys = getRoleKeys(req);
        if (!svc.isCommitteeAdmin(roleKeys)) {
            return next(new AppError("Only a Committee Admin can approve a budget.", 403, "ACCESS_DENIED"));
        }

        const updated = await svc.approve({
            budgetId:  req.params.id,
            societyId: req.societyId,
            userId:    req.user.id,
            userRole:  req.user.role,
            comment:   req.body.comment || null,
            requireDifferentApprover: false, // TODO(BA): pull from society settings
            db:        req.opsDb,
        });

        return sendSuccess(res, 200, "Budget approved and activated.", { budget: updated });
    } catch (err) {
        next(err);
    }
}

/**
 * POST /budgets/:id/send-back
 * Send back to draft. BRD 4.1: Committee Admin only.
 */
async function sendBackBudget(req, res, next) {
    try {
        const roleKeys = getRoleKeys(req);
        if (!svc.isCommitteeAdmin(roleKeys)) {
            return next(new AppError("Only a Committee Admin can send back a budget.", 403, "ACCESS_DENIED"));
        }

        const updated = await svc.sendBack({
            budgetId:  req.params.id,
            societyId: req.societyId,
            userId:    req.user.id,
            userRole:  req.user.role,
            comment:   req.body.comment || null,
            db:        req.opsDb,
        });

        return sendSuccess(res, 200, "Budget sent back to draft.", { budget: updated });
    } catch (err) {
        next(err);
    }
}

/**
 * POST /budgets/:id/withdraw
 * Withdraw to draft. BRD 4.1: Accountant only.
 */
async function withdrawBudget(req, res, next) {
    try {
        const roleKeys = getRoleKeys(req);
        if (!svc.isAccountant(roleKeys)) {
            return next(new AppError("Only an Accountant can withdraw a budget submission.", 403, "ACCESS_DENIED"));
        }

        const updated = await svc.withdraw({
            budgetId:  req.params.id,
            societyId: req.societyId,
            userId:    req.user.id,
            userRole:  req.user.role,
            db:        req.opsDb,
        });

        return sendSuccess(res, 200, "Budget withdrawn to draft.", { budget: updated });
    } catch (err) {
        next(err);
    }
}

/**
 * GET /budgets/:id/history
 * Audit trail. All permissioned roles can view.
 */
async function getBudgetHistory(req, res, next) {
    try {
        if (svc.isSuperAdmin(req.user?.role)) {
            return next(new AppError("Super Admin does not have access to budgets.", 403, "ACCESS_DENIED"));
        }

        // Confirm budget exists and is visible to this user
        const { getBudgetModels } = require("./budget.model");
        const { Budget } = getBudgetModels(req.opsDb);
        const budget = await Budget.findOne({ _id: req.params.id, societyId: req.societyId }).lean();
        if (!budget) return next(new AppError("Budget not found.", 404, "BUDGET_NOT_FOUND"));
        if (!svc.canView(req.user, budget.status)) {
            return next(new AppError("Budget not found.", 404, "BUDGET_NOT_FOUND"));
        }

        const history = await svc.getBudgetHistory({
            budgetId:  req.params.id,
            societyId: req.societyId,
            db:        req.opsDb,
        });

        return sendSuccess(res, 200, "Budget history fetched.", { history });
    } catch (err) {
        next(err);
    }
}

/**
 * GET /budgets/eligible-accounts
 * List active INCOME/EXPENSE accounts for the line picker.
 */
async function getEligibleAccounts(req, res, next) {
    try {
        const roleKeys = getRoleKeys(req);
        if (svc.isSuperAdmin(req.user?.role)) {
            return next(new AppError("Access denied.", 403, "ACCESS_DENIED"));
        }
        if (!svc.isAccountant(roleKeys) && !svc.isCommitteeAdmin(roleKeys)) {
            return next(new AppError("Access denied.", 403, "ACCESS_DENIED"));
        }

        const accounts = await svc.getEligibleAccounts({
            societyId: req.societyId,
            db:        req.opsDb,
        });

        return sendSuccess(res, 200, "Eligible accounts fetched.", { accounts });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    listBudgets,
    createBudget,
    getBudget,
    getBudgetVsActual,
    saveLines,
    submitBudget,
    approveBudget,
    sendBackBudget,
    withdrawBudget,
    getBudgetHistory,
    getEligibleAccounts,
};
