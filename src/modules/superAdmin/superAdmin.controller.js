"use strict";

const SuperAdminService = require("./superAdmin.service");
const { sendSuccess } = require("../../utils/response.utils");

class SuperAdminController {
    /**
     * @desc    Get dashboard metrics for super admin
     * @route   GET /api/v1/super-admin/stats
     * @access  Private (Super Admin)
     */
    async getStats(req, res, next) {
        try {
            const stats = await SuperAdminService.getDashboardStats();
            return sendSuccess(res, 200, "Dashboard stats fetched successfully", stats);
        } catch (error) {
            next(error);
        }
    }

    /**
     * @desc    Get paginated societies list
     * @route   GET /api/v1/super-admin/societies
     * @access  Private (Super Admin)
     */
    async getSocieties(req, res, next) {
        try {
            const { page, limit, search } = req.query;
            const data = await SuperAdminService.getSocieties(page, limit, search);
            return sendSuccess(res, 200, "Societies fetched successfully", data);
        } catch (error) {
            next(error);
        }
    }

    /**
     * @desc    Create a new super admin
     * @route   POST /api/v1/super-admin/admins
     * @access  Private (Super Admin)
     */
    async createSuperAdmin(req, res, next) {
        try {
            const { name, email, password } = req.body;
            // The pre-save hook on SuperAdmin model hashes the password automatically
            const newAdmin = await SuperAdminService.createSuperAdmin({ name, email, password });
            
            // Remove password from response
            newAdmin.password = undefined;

            return sendSuccess(res, 201, "Super Admin created successfully", { admin: newAdmin });
        } catch (error) {
            next(error);
        }
    }

    /**
     * @desc    Create a new society and invite admin
     * @route   POST /api/v1/super-admin/societies
     * @access  Private (Super Admin)
     */
    async createSociety(req, res, next) {
        try {
            const data = await SuperAdminService.createSociety(req.body);
            return sendSuccess(res, 201, "Society created and admin invited successfully", data);
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new SuperAdminController();
