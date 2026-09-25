"use strict";

const { AdvanceAccountsService, SecurityDepositService } = require("./advanceAccountsDeposits.service");
const { sendSuccess, sendPaginated } = require("../../utils/response.utils");

class AdvanceAccountsController {
    // ── ADVANCE ACCOUNTS ──────────────────────────────────────────────────
    static async getOrCreateAccount(req, res, next) {
        try {
            const { residentId, flatId } = req.body;
            const account = await AdvanceAccountsService.getOrCreateAccount(req, residentId, flatId);
            return sendSuccess(res, 200, "Advance account retrieved or created.", account);
        } catch (err) {
            next(err);
        }
    }

    static async listAccounts(req, res, next) {
        try {
            const result = await AdvanceAccountsService.listAccounts(req);
            return sendPaginated(res, 200, "Advance accounts fetched.", result.accounts, result.meta);
        } catch (err) {
            next(err);
        }
    }

    static async getAccountById(req, res, next) {
        try {
            const account = await AdvanceAccountsService.getAccountById(req, req.params.id);
            return sendSuccess(res, 200, "Account details fetched.", account);
        } catch (err) {
            next(err);
        }
    }

    static async getMyAccount(req, res, next) {
        try {
            const account = await AdvanceAccountsService.getMyAccount(req);
            return sendSuccess(res, 200, "My advance account fetched.", account);
        } catch (err) {
            next(err);
        }
    }

    static async creditAccount(req, res, next) {
        try {
            const result = await AdvanceAccountsService.creditAdvanceAccount(req, req.params.id, req.body);
            return sendSuccess(res, 200, "Advance credited successfully.", result);
        } catch (err) {
            next(err);
        }
    }

    static async initiateAdvanceOnlinePayment(req, res, next) {
        try {
            const result = await AdvanceAccountsService.initiateAdvanceOnlinePayment(req, req.body);
            return sendSuccess(res, 200, "Razorpay order created for advance top-up.", result);
        } catch (err) {
            next(err);
        }
    }

    static async verifyAdvanceOnlinePayment(req, res, next) {
        try {
            const result = await AdvanceAccountsService.verifyAdvanceOnlinePayment(req, req.body);
            return sendSuccess(res, 200, "Advance payment verified and credited.", result);
        } catch (err) {
            next(err);
        }
    }

    static async allocateAdvance(req, res, next) {
        try {
            const result = await AdvanceAccountsService.allocateAdvance(req, req.params.id, req.body);
            return sendSuccess(res, 200, "Advance allocated successfully.", result);
        } catch (err) {
            next(err);
        }
    }

    static async reverseAllocation(req, res, next) {
        try {
            const result = await AdvanceAccountsService.reverseAllocation(req, req.params.id, req.body);
            return sendSuccess(res, 200, "Allocation reversed successfully.", result);
        } catch (err) {
            next(err);
        }
    }

    static async refundAdvance(req, res, next) {
        try {
            const result = await AdvanceAccountsService.refundAdvance(req, req.params.id, req.body);
            return sendSuccess(res, 200, "Advance refunded successfully.", result);
        } catch (err) {
            next(err);
        }
    }

    static async getAccountStatement(req, res, next) {
        try {
            const result = await AdvanceAccountsService.getAccountStatement(req, req.params.id);
            return sendSuccess(res, 200, "Account statement fetched.", result);
        } catch (err) {
            next(err);
        }
    }

    static async listAllocations(req, res, next) {
        try {
            const result = await AdvanceAccountsService.listAllocations(req);
            return sendPaginated(res, 200, "Allocations fetched.", result.allocations, result.meta);
        } catch (err) {
            next(err);
        }
    }

    static async getOverviewStats(req, res, next) {
        try {
            const result = await AdvanceAccountsService.getOverviewStats(req);
            return sendSuccess(res, 200, "Overview stats fetched.", result);
        } catch (err) {
            next(err);
        }
    }
}

class SecurityDepositsController {
    // ── SECURITY DEPOSITS ──────────────────────────────────────────────────
    static async listDepositTypes(req, res, next) {
        try {
            const types = await SecurityDepositService.listDepositTypes(req);
            return sendSuccess(res, 200, "Deposit types fetched.", types);
        } catch (err) {
            next(err);
        }
    }

    static async createDepositType(req, res, next) {
        try {
            const dt = await SecurityDepositService.createDepositType(req, req.body);
            return sendSuccess(res, 201, "Deposit type created.", dt);
        } catch (err) {
            next(err);
        }
    }

    static async updateDepositType(req, res, next) {
        try {
            const dt = await SecurityDepositService.updateDepositType(req, req.params.id, req.body);
            return sendSuccess(res, 200, "Deposit type updated.", dt);
        } catch (err) {
            next(err);
        }
    }

    static async listDeposits(req, res, next) {
        try {
            const result = await SecurityDepositService.listDeposits(req);
            return sendPaginated(res, 200, "Deposits fetched.", result.deposits, result.meta);
        } catch (err) {
            next(err);
        }
    }

    static async getMyDeposits(req, res, next) {
        try {
            const deposits = await SecurityDepositService.getMyDeposits(req);
            return sendSuccess(res, 200, "My deposits fetched.", deposits);
        } catch (err) {
            next(err);
        }
    }

    static async getDepositById(req, res, next) {
        try {
            const deposit = await SecurityDepositService.getDepositById(req, req.params.id);
            return sendSuccess(res, 200, "Deposit details fetched.", deposit);
        } catch (err) {
            next(err);
        }
    }

    static async collectDeposit(req, res, next) {
        try {
            const deposit = await SecurityDepositService.collectDeposit(req, req.body);
            return sendSuccess(res, 201, "Deposit collected successfully.", deposit);
        } catch (err) {
            next(err);
        }
    }

    static async adjustDeposit(req, res, next) {
        try {
            const deposit = await SecurityDepositService.adjustDeposit(req, req.params.id, req.body);
            return sendSuccess(res, 200, "Deposit adjusted successfully.", deposit);
        } catch (err) {
            next(err);
        }
    }

    static async requestRefund(req, res, next) {
        try {
            const refundRequest = await SecurityDepositService.requestRefund(req, req.params.id, req.body);
            return sendSuccess(res, 201, "Refund requested successfully.", refundRequest);
        } catch (err) {
            next(err);
        }
    }

    static async approveRefund(req, res, next) {
        try {
            const result = await SecurityDepositService.approveRefund(req, req.params.id, req.body);
            return sendSuccess(res, 200, "Refund approved.", result);
        } catch (err) {
            next(err);
        }
    }

    static async rejectRefund(req, res, next) {
        try {
            const result = await SecurityDepositService.rejectRefund(req, req.params.id, req.body);
            return sendSuccess(res, 200, "Refund rejected.", result);
        } catch (err) {
            next(err);
        }
    }

    static async processRefund(req, res, next) {
        try {
            const result = await SecurityDepositService.processRefund(req, req.params.id, req.body);
            return sendSuccess(res, 200, "Refund processed.", result);
        } catch (err) {
            next(err);
        }
    }

    static async listRefundRequests(req, res, next) {
        try {
            const result = await SecurityDepositService.listRefundRequests(req);
            return sendPaginated(res, 200, "Refund requests fetched.", result.refunds, result.meta);
        } catch (err) {
            next(err);
        }
    }

    static async getDepositStatement(req, res, next) {
        try {
            const result = await SecurityDepositService.getDepositStatement(req, req.params.id);
            return sendSuccess(res, 200, "Deposit statement fetched.", result);
        } catch (err) {
            next(err);
        }
    }

    static async listAllTransactions(req, res, next) {
        try {
            const result = await SecurityDepositService.listAllTransactions(req);
            return sendPaginated(res, 200, "Transactions fetched.", result.transactions, result.meta);
        } catch (err) {
            next(err);
        }
    }

    static async getAuditLogs(req, res, next) {
        try {
            const result = await SecurityDepositService.getAuditLogs(req);
            return sendPaginated(res, 200, "Audit logs fetched.", result.logs, result.meta);
        } catch (err) {
            next(err);
        }
    }
}

module.exports = { AdvanceAccountsController, SecurityDepositsController };
