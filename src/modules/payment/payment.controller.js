"use strict";

const PaymentService = require("./payment.service");
const { sendSuccess, sendError, sendPaginated } = require("../../utils/response.utils");

class PaymentController {
    // ── Initiate Online Payment (Resident) ──
    static async initiateOnlinePayment(req, res, next) {
        try {
            const societyId = req.user?.societyId || req.headers["x-society-id"] || req.query.societyId;
            const userId = req.user?.id;
            const { invoiceId, amount, paymentMode } = req.body;

            if (!societyId) return sendError(res, 400, "Society ID is required.");
            if (!invoiceId) return sendError(res, 400, "Invoice ID is required.");

            const db = req.opsDb;
            const result = await PaymentService.initiateOnlinePayment({
                req,
                db,
                societyId,
                userId,
                invoiceId,
                amount,
                paymentMode,
            });

            return sendSuccess(res, 200, "Payment order initiated successfully.", result);
        } catch (err) {
            return sendError(res, 400, err.message || "Failed to initiate online payment.");
        }
    }

    // ── Verify Online Payment ──
    static async verifyOnlinePayment(req, res, next) {
        try {
            const societyId = req.user?.societyId || req.headers["x-society-id"] || req.query.societyId;
            const userId = req.user?.id;
            const { razorpay_order_id, razorpay_payment_id, razorpay_signature, paymentId } = req.body;

            if (!societyId) return sendError(res, 400, "Society ID is required.");

            const db = req.opsDb;
            const result = await PaymentService.verifyOnlinePayment({
                req,
                db,
                societyId,
                userId,
                razorpay_order_id,
                razorpay_payment_id,
                razorpay_signature,
                paymentId,
            });

            return sendSuccess(res, 200, "Payment verified and processed successfully.", result);
        } catch (err) {
            return sendError(res, 400, err.message || "Payment verification failed.");
        }
    }

    // ── Razorpay Webhook Handler ──
    static async handleWebhook(req, res, next) {
        try {
            const signature = req.headers["x-razorpay-signature"];
            const db = req.opsDb;
            const result = await PaymentService.handleWebhook({
                db,
                webhookPayload: req.body,
                signature,
            });
            return res.status(200).json({ status: "ok", ...result });
        } catch (err) {
            console.error("[WEBHOOK ERROR]", err);
            return res.status(400).json({ status: "error", message: err.message });
        }
    }

    // ── Record Offline Payment (Accountant) ──
    static async recordOfflinePayment(req, res, next) {
        try {
            const societyId = req.user?.societyId || req.body.societyId || req.headers["x-society-id"];
            const recordedBy = req.user?.id;

            const {
                flatId,
                userId,
                invoiceId,
                amount,
                paymentMode,
                referenceNumber,
                paymentAccountId,
                paymentAccountName,
                notes,
                paymentDate,
                chequeDetails,
                bankTransferDetails,
            } = req.body;

            if (!societyId) return sendError(res, 400, "Society ID is required.");
            if (!flatId) return sendError(res, 400, "Flat selection is required.");
            if (!amount) return sendError(res, 400, "Payment amount is required.");

            const db = req.opsDb;
            const result = await PaymentService.recordOfflinePayment({
                req,
                db,
                societyId,
                recordedBy,
                flatId,
                userId: userId || req.user?.id,
                invoiceId,
                amount,
                paymentMode,
                referenceNumber,
                paymentAccountId,
                paymentAccountName,
                notes,
                paymentDate,
                chequeDetails,
                bankTransferDetails,
            });

            return sendSuccess(res, 201, "Offline payment recorded successfully.", result);
        } catch (err) {
            return sendError(res, 400, err.message || "Failed to record offline payment.");
        }
    }

    // ── Get Overview Metrics ──
    static async getOverview(req, res, next) {
        try {
            const societyId = req.user?.societyId || req.query.societyId || req.headers["x-society-id"];
            if (!societyId) return sendError(res, 400, "Society ID is required.");

            const db = req.opsDb;
            const stats = await PaymentService.getOverviewStats({
                db,
                societyId,
                startDate: req.query.startDate,
                endDate: req.query.endDate,
                wing: req.query.wing,
                blockId: req.query.blockId,
                flatId: req.query.flatId,
                paymentMode: req.query.paymentMode,
                paymentAccountId: req.query.paymentAccountId,
            });

            return sendSuccess(res, 200, "Payment metrics fetched successfully.", stats);
        } catch (err) {
            return sendError(res, 500, err.message || "Failed to fetch metrics.");
        }
    }

    // ── Get Paginated Payments List ──
    static async getPaymentsList(req, res, next) {
        try {
            const societyId = req.user?.societyId || req.query.societyId || req.headers["x-society-id"];
            if (!societyId) return sendError(res, 400, "Society ID is required.");

            // If resident, enforce own residentId scope
            let residentId = req.query.residentId;
            const isResident = req.user?.role === "resident_owner" || req.user?.role === "resident_tenant";
            if (isResident) {
                residentId = req.user.id;
            }

            const db = req.opsDb;
            const result = await PaymentService.getPaymentsList({
                db,
                societyId,
                page: req.query.page,
                limit: req.query.limit,
                search: req.query.search,
                startDate: req.query.startDate,
                endDate: req.query.endDate,
                flatId: req.query.flatId,
                paymentMode: req.query.paymentMode,
                paymentStatus: req.query.paymentStatus,
                paymentSource: req.query.paymentSource,
                paymentAccountId: req.query.paymentAccountId,
                residentId,
                invoiceId: req.query.invoiceId,
            });

            return sendPaginated(res, 200, "Payments retrieved successfully.", result.data, result.pagination);
        } catch (err) {
            return sendError(res, 500, err.message || "Failed to fetch payments.");
        }
    }

    // ── Get Pending / Failed / Unmatched Payments ──
    static async getPendingFailed(req, res, next) {
        try {
            const societyId = req.user?.societyId || req.query.societyId || req.headers["x-society-id"];
            if (!societyId) return sendError(res, 400, "Society ID is required.");

            const db = req.opsDb;
            const result = await PaymentService.getPendingFailedPayments({
                db,
                societyId,
                page: req.query.page,
                limit: req.query.limit,
                search: req.query.search,
            });

            return sendPaginated(res, 200, "Pending & failed payments retrieved successfully.", result.data, result.pagination);
        } catch (err) {
            return sendError(res, 500, err.message || "Failed to fetch pending/failed payments.");
        }
    }

    // ── Manual Reconciliation ──
    static async manualReconcile(req, res, next) {
        try {
            const societyId = req.user?.societyId || req.body.societyId || req.headers["x-society-id"];
            const userId = req.user?.id;
            const { paymentId, invoiceId } = req.body;

            if (!societyId) return sendError(res, 400, "Society ID is required.");
            if (!paymentId || !invoiceId) return sendError(res, 400, "Payment ID and Invoice ID are required.");

            const db = req.opsDb;
            const result = await PaymentService.manualReconcilePayment({
                req,
                db,
                societyId,
                paymentId,
                invoiceId,
                userId,
            });

            return sendSuccess(res, 200, "Payment reconciled successfully.", result);
        } catch (err) {
            return sendError(res, 400, err.message || "Manual reconciliation failed.");
        }
    }

    // ── Get Collections Analytics ──
    static async getCollectionsAnalytics(req, res, next) {
        try {
            const societyId = req.user?.societyId || req.query.societyId || req.headers["x-society-id"];
            if (!societyId) return sendError(res, 400, "Society ID is required.");

            const db = req.opsDb;
            const analytics = await PaymentService.getCollectionsAnalytics({
                db,
                societyId,
                startDate: req.query.startDate,
                endDate: req.query.endDate,
                flatId: req.query.flatId,
                paymentAccountId: req.query.paymentAccountId,
            });

            return sendSuccess(res, 200, "Collection analytics retrieved successfully.", analytics);
        } catch (err) {
            return sendError(res, 500, err.message || "Failed to fetch collection analytics.");
        }
    }
}

module.exports = PaymentController;