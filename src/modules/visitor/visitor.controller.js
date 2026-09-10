"use strict";

const VisitorService = require("./visitor.service");
const { sendSuccess, sendError } = require("../../utils/response.utils");

class VisitorController {
    /**
     * @desc    Add Walk-in visitor (Guard action)
     * @route   POST /api/v1/visitor/walk-in
     */
    async addWalkInVisitor(req, res, next) {
        try {
            const data = await VisitorService.addWalkInVisitor({
                ...req.body,
                societyId: req.user.societyId,
                guardId: req.user.id
            });
            return sendSuccess(res, 201, "Visitor added, pending approval", data);
        } catch (error) {
            next(error);
        }
    }

    /**
     * @desc    Approve or Deny Visitor (Resident action)
     * @route   PATCH /api/v1/visitor/:id/approve
     */
    async approveVisitor(req, res, next) {
        try {
            const { status } = req.body;
            if (!["approved", "rejected"].includes(status)) {
                return sendError(res, 400, "Invalid status. Must be approved or rejected.");
            }
            const data = await VisitorService.approveVisitor(
                req.params.id,
                req.user.societyId,
                req.user.id,
                status
            );
            return sendSuccess(res, 200, `Visitor ${status} successfully`, data);
        } catch (error) {
            next(error);
        }
    }

    /**
     * @desc    Get pending visitors for resident's flat
     * @route   GET /api/v1/visitor/pending
     */
    async getPendingVisitors(req, res, next) {
        try {
            const data = await VisitorService.getPendingVisitors(
                req.user.societyId,
                req.user.flatId
            );
            return sendSuccess(res, 200, "Pending visitors fetched", data);
        } catch (error) {
            next(error);
        }
    }

    /**
     * @desc    Get all visitor history for admin
     * @route   GET /api/v1/visitor/history
     */
    async getVisitorHistory(req, res, next) {
        try {
            const data = await VisitorService.getVisitorHistory(
                req.user.societyId,
                req.query
            );
            return sendSuccess(res, 200, "Visitor history fetched", data);
        } catch (error) {
            next(error);
        }
    }

    /**
     * @desc    Get single visitor entry status
     * @route   GET /api/v1/visitor/:id
     */
    async getVisitorById(req, res, next) {
        try {
            const data = await VisitorService.getVisitorById(
                req.params.id,
                req.user.societyId
            );
            return sendSuccess(res, 200, "Visitor entry fetched", data);
        } catch (error) {
            next(error);
        }
    }

    /**
     * @desc    Create Digital QR Pass (Resident action)
     * @route   POST /api/v1/visitor/qr-pass
     */
    async createQrPass(req, res, next) {
        try {
            const data = await VisitorService.createQrPass(
                req.body,
                req.user.id,
                req.user.societyId
            );
            return sendSuccess(res, 201, "QR Pass created successfully", data);
        } catch (error) {
            next(error);
        }
    }

    /**
     * @desc    Get QR Passes for resident/flat
     * @route   GET /api/v1/visitor/qr-pass
     */
    async getMyQrPasses(req, res, next) {
        try {
            const data = await VisitorService.getMyQrPasses(
                req.user.id,
                req.user.societyId,
                req.user.flatId
            );
            return sendSuccess(res, 200, "QR Passes fetched", data);
        } catch (error) {
            next(error);
        }
    }

    /**
     * @desc    Revoke QR Pass (Resident action)
     * @route   PATCH /api/v1/visitor/qr-pass/:id/revoke
     */
    async revokeQrPass(req, res, next) {
        try {
            const data = await VisitorService.revokeQrPass(
                req.params.id,
                req.user.id,
                req.user.societyId
            );
            return sendSuccess(res, 200, "QR Pass revoked", data);
        } catch (error) {
            next(error);
        }
    }

    /**
     * @desc    Validate QR Pass (Guard action)
     * @route   POST /api/v1/visitor/qr-scan
     */
    async validateQrPass(req, res, next) {
        try {
            const { qrCode, gateId } = req.body;
            if (!qrCode) {
                return sendError(res, 400, "qrCode is required");
            }
            const data = await VisitorService.validateQrPass(
                qrCode, 
                gateId, 
                req.user.societyId,
                req.user.id
            );
            return sendSuccess(res, 200, "QR Pass Validated & Check-in Successful", data);
        } catch (error) {
            // Include errorCode and qrPass details in error response if present
            if (error.errorCode) {
                return res.status(error.statusCode || 400).json({
                    status: "fail",
                    message: error.message,
                    errorCode: error.errorCode,
                    qrPass: error.qrPass || null
                });
            }
            next(error);
        }
    }
}
module.exports = new VisitorController();
