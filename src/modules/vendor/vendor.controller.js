"use strict";

const VendorService = require("./vendor.service");
const { sendSuccess } = require("../../utils/response.utils");

class VendorController {
    // ── Admin CRUD ────────────────────────────────────────────────────────────

    async createVendor(req, res, next) {
        try {
            const data = await VendorService.createVendor(req.societyId, req.body, req.user.id);
            return sendSuccess(res, 201, "Vendor created successfully", data);
        } catch (error) {
            next(error);
        }
    }

    async getVendors(req, res, next) {
        try {
            const { status, serviceCategory } = req.query;
            const filter = {};
            if (status) filter.status = status;
            if (serviceCategory) filter.serviceCategory = serviceCategory;
            const data = await VendorService.getVendors(req.societyId, filter);
            return sendSuccess(res, 200, "Vendors retrieved successfully", data);
        } catch (error) {
            next(error);
        }
    }

    async getVendorById(req, res, next) {
        try {
            const data = await VendorService.getVendorById(req.societyId, req.params.id);
            return sendSuccess(res, 200, "Vendor retrieved successfully", data);
        } catch (error) {
            next(error);
        }
    }

    async updateVendor(req, res, next) {
        try {
            const data = await VendorService.updateVendor(req.societyId, req.params.id, req.body, req.user.id);
            return sendSuccess(res, 200, "Vendor updated successfully", data);
        } catch (error) {
            next(error);
        }
    }

    async getVendorHistory(req, res, next) {
        try {
            const data = await VendorService.getVendorHistory(req.societyId, req.params.id);
            return sendSuccess(res, 200, "Vendor history retrieved successfully", data);
        } catch (error) {
            next(error);
        }
    }

    // ── Task Assignment ───────────────────────────────────────────────────────

    async getAllTasks(req, res, next) {
        try {
            const data = await VendorService.getAllTasksForAssignment(req.societyId);
            return sendSuccess(res, 200, "Tasks retrieved successfully", data);
        } catch (error) {
            next(error);
        }
    }

    async assignTask(req, res, next) {
        try {
            const data = await VendorService.assignTask(
                req.societyId,
                req.params.taskId,
                req.body.vendorId,
                req.user.id
            );
            return sendSuccess(res, 200, "Task assigned to vendor successfully", data);
        } catch (error) {
            next(error);
        }
    }

    async reassignTask(req, res, next) {
        try {
            // Reassign uses the same atomic flow as assign — history is preserved in the service
            const data = await VendorService.assignTask(
                req.societyId,
                req.params.taskId,
                req.body.vendorId,
                req.user.id
            );
            return sendSuccess(res, 200, "Task reassigned to vendor successfully", data);
        } catch (error) {
            next(error);
        }
    }

    // ── Vendor Portal ─────────────────────────────────────────────────────────
    // vendorId is resolved from the authenticated user's linked Vendor record.

    async getVendorTasks(req, res, next) {
        try {
            // Look up the Vendor record linked to this user account
            const vendorId = await VendorService.getVendorIdForUser(req.societyId, req.user.id);
            const data = await VendorService.getVendorTasks(req.societyId, vendorId);
            return sendSuccess(res, 200, "Vendor tasks retrieved successfully", data);
        } catch (error) {
            next(error);
        }
    }

    async getVendorTaskById(req, res, next) {
        try {
            const vendorId = await VendorService.getVendorIdForUser(req.societyId, req.user.id);
            const data = await VendorService.getVendorTaskById(req.societyId, vendorId, req.params.taskId);
            return sendSuccess(res, 200, "Vendor task retrieved successfully", data);
        } catch (error) {
            next(error);
        }
    }

    async updateVendorTask(req, res, next) {
        try {
            const vendorId = await VendorService.getVendorIdForUser(req.societyId, req.user.id);
            const data = await VendorService.updateVendorTask(
                req.societyId,
                vendorId,
                req.params.taskId,
                req.body
            );
            return sendSuccess(res, 200, "Vendor task updated successfully", data);
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new VendorController();
