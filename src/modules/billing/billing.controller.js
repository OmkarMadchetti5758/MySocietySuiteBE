"use strict";

const BillingService = require("./billing.service");
const { sendSuccess } = require("../../utils/response.utils");
const { getBillingAuditModel } = require("../../services/billingAudit.service");

class BillingController {
    static async createChargeHead(req, res, next) {
        try {
            const chargeHead = await BillingService.createChargeHead(req, req.body);
            return sendSuccess(res, 201, "Charge head created successfully (Pending Approval)", chargeHead);
        } catch (err) {
            next(err);
        }
    }

    static async updateChargeHead(req, res, next) {
        try {
            const chargeHead = await BillingService.updateChargeHead(req, req.params.id, req.body);
            return sendSuccess(res, 200, "Charge head updated successfully", chargeHead);
        } catch (err) {
            next(err);
        }
    }

    static async submitChargeHead(req, res, next) {
        try {
            const chargeHead = await BillingService.submitChargeHead(req, req.params.id);
            return sendSuccess(res, 200, "Charge head submitted for approval successfully", chargeHead);
        } catch (err) {
            next(err);
        }
    }

    static async approveChargeHead(req, res, next) {
        try {
            const { action = "approve", rejectionReason } = req.body;
            const chargeHead = await BillingService.approveChargeHead(req, req.params.id, action, rejectionReason);
            return sendSuccess(res, 200, `Charge head ${action === "reject" ? "rejected" : "approved"} successfully`, chargeHead);
        } catch (err) {
            next(err);
        }
    }

    static async rejectChargeHead(req, res, next) {
        try {
            const { rejectionReason } = req.body;
            const chargeHead = await BillingService.approveChargeHead(req, req.params.id, "reject", rejectionReason);
            return sendSuccess(res, 200, "Charge head rejected successfully", chargeHead);
        } catch (err) {
            next(err);
        }
    }

    static async getChargeHeads(req, res, next) {
        try {
            const list = await BillingService.getChargeHeads(req);
            return sendSuccess(res, 200, "Charge heads fetched successfully", list);
        } catch (err) {
            next(err);
        }
    }

    static async getChargeHeadById(req, res, next) {
        try {
            const chargeHead = await BillingService.getChargeHeadById(req, req.params.id);
            return sendSuccess(res, 200, "Charge head details fetched successfully", chargeHead);
        } catch (err) {
            next(err);
        }
    }

    static async deleteChargeHead(req, res, next) {
        try {
            const result = await BillingService.deleteChargeHead(req, req.params.id);
            return sendSuccess(res, 200, result.message, result);
        } catch (err) {
            next(err);
        }
    }

    static async getBillingConfig(req, res, next) {
        try {
            const config = await BillingService.getBillingConfig(req);
            return sendSuccess(res, 200, "Billing configuration fetched successfully", config);
        } catch (err) {
            next(err);
        }
    }

    static async upsertBillingConfig(req, res, next) {
        try {
            const config = await BillingService.upsertBillingConfig(req, req.body);
            return sendSuccess(res, 200, "Billing configuration saved successfully", config);
        } catch (err) {
            next(err);
        }
    }

    static async generateInvoice(req, res, next) {
        try {
            const invoice = await BillingService.generateInvoice(req, req.body);
            return sendSuccess(res, 201, "Invoice generated successfully", invoice);
        } catch (err) {
            next(err);
        }
    }

    static async getInvoices(req, res, next) {
        try {
            const invoices = await BillingService.getInvoices(req);
            return sendSuccess(res, 200, "Invoices fetched successfully", invoices);
        } catch (err) {
            next(err);
        }
    }

    static async getMyInvoices(req, res, next) {
        try {
            const invoices = await BillingService.getMyInvoices(req);
            return sendSuccess(res, 200, "Own invoices fetched successfully", invoices);
        } catch (err) {
            next(err);
        }
    }

    static async getMyInvoiceById(req, res, next) {
        try {
            const invoice = await BillingService.getMyInvoiceById(req, req.params.id);
            return sendSuccess(res, 200, "Invoice details fetched successfully", invoice);
        } catch (err) {
            next(err);
        }
    }

    static async recordOfflinePayment(req, res, next) {
        try {
            const invoice = await BillingService.recordOfflinePayment(req, req.body);
            return sendSuccess(res, 200, "Offline payment recorded successfully", invoice);
        } catch (err) {
            next(err);
        }
    }

    static async payMyInvoice(req, res, next) {
        try {
            const { amountPaid } = req.body;
            const invoice = await BillingService.payMyInvoice(req, req.params.id, amountPaid);
            return sendSuccess(res, 200, "Payment processed successfully", invoice);
        } catch (err) {
            next(err);
        }
    }

    static async createCreditNote(req, res, next) {
        try {
            const creditNote = await BillingService.createCreditNote(req, req.body);
            return sendSuccess(res, 201, "Credit note created successfully", creditNote);
        } catch (err) {
            next(err);
        }
    }

    static async approveCreditNote(req, res, next) {
        try {
            const { action } = req.body;
            const creditNote = await BillingService.approveCreditNote(req, req.params.id, action);
            return sendSuccess(res, 200, `Credit note ${action === "reject" ? "rejected" : "approved"} successfully`, creditNote);
        } catch (err) {
            next(err);
        }
    }

    static async createDiscount(req, res, next) {
        try {
            const discount = await BillingService.createDiscount(req, req.body);
            return sendSuccess(res, 201, "Discount created successfully", discount);
        } catch (err) {
            next(err);
        }
    }

    static async approveDiscount(req, res, next) {
        try {
            const { action } = req.body;
            const discount = await BillingService.approveDiscount(req, req.params.id, action);
            return sendSuccess(res, 200, `Discount ${action === "reject" ? "rejected" : "approved"} successfully`, discount);
        } catch (err) {
            next(err);
        }
    }

    static async createJournalVoucher(req, res, next) {
        try {
            const voucher = await BillingService.createJournalVoucher(req, req.body);
            return sendSuccess(res, 201, "Journal voucher created successfully (Pending Approval)", voucher);
        } catch (err) {
            next(err);
        }
    }

    static async approveJournalVoucher(req, res, next) {
        try {
            const { action } = req.body;
            const voucher = await BillingService.approveJournalVoucher(req, req.params.id, action);
            return sendSuccess(res, 200, `Journal voucher ${action === "reject" ? "rejected" : "approved"} successfully`, voucher);
        } catch (err) {
            next(err);
        }
    }

    static async createVendorPayment(req, res, next) {
        try {
            const payment = await BillingService.createVendorPayment(req, req.body);
            return sendSuccess(res, 201, "Vendor payment created successfully", payment);
        } catch (err) {
            next(err);
        }
    }

    static async approveVendorPayment(req, res, next) {
        try {
            const { action } = req.body;
            const payment = await BillingService.approveVendorPayment(req, req.params.id, action);
            return sendSuccess(res, 200, `Vendor payment ${action === "reject" ? "rejected" : "approved"} successfully`, payment);
        } catch (err) {
            next(err);
        }
    }

    static async createBudget(req, res, next) {
        try {
            const budget = await BillingService.createBudgetDraft(req, req.body);
            return sendSuccess(res, 201, "Budget draft created successfully", budget);
        } catch (err) {
            next(err);
        }
    }

    static async approveBudget(req, res, next) {
        try {
            const { action } = req.body;
            const budget = await BillingService.approveBudget(req, req.params.id, action);
            return sendSuccess(res, 200, `Budget ${action === "reject" ? "rejected" : "approved"} successfully`, budget);
        } catch (err) {
            next(err);
        }
    }

    static async reconcileAccounts(req, res, next) {
        try {
            const rec = await BillingService.reconcileAccounts(req, req.body);
            return sendSuccess(res, 201, "Reconciliation recorded successfully", rec);
        } catch (err) {
            next(err);
        }
    }

    static async getFinancialReports(req, res, next) {
        try {
            const report = await BillingService.getFinancialReports(req);
            return sendSuccess(res, 200, "Financial report fetched successfully", report);
        } catch (err) {
            next(err);
        }
    }

    static async getMyLedger(req, res, next) {
        try {
            const ledger = await BillingService.getMyLedger(req);
            return sendSuccess(res, 200, "Own flat ledger statement fetched successfully", ledger);
        } catch (err) {
            next(err);
        }
    }

    static async getAuditLogs(req, res, next) {
        try {
            const AuditModel = getBillingAuditModel(req.opsDb);
            const logs = await AuditModel.find({ societyId: req.user.societyId })
                .sort({ createdAt: -1 })
                .limit(100)
                .lean();
            return sendSuccess(res, 200, "Billing audit logs fetched successfully", logs);
        } catch (err) {
            next(err);
        }
    }
}

module.exports = BillingController;
