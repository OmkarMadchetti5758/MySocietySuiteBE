"use strict";

const SuperAdminService = require("./superAdmin.service");
const { sendSuccess } = require("../../utils/response.utils");

class SuperAdminController {
    async getStats(req, res, next) {
        try {
            const stats = await SuperAdminService.getDashboardStats();
            return sendSuccess(res, 200, "Dashboard stats fetched successfully", stats);
        } catch (error) {
            next(error);
        }
    }

    async getSubscriptionPlans(req, res, next) {
        try {
            const plans = await SuperAdminService.getSubscriptionPlans();
            return sendSuccess(res, 200, "Subscription plans fetched successfully", plans);
        } catch (error) {
            next(error);
        }
    }

    async getSocieties(req, res, next) {
        try {
            const { page, limit, search } = req.query;
            const data = await SuperAdminService.getSocieties(page, limit, search);
            return sendSuccess(res, 200, "Societies fetched successfully", data);
        } catch (error) {
            next(error);
        }
    }

    async getAvailableModules(req, res, next) {
        try {
            const modules = await SuperAdminService.getAvailableModules();
            return sendSuccess(res, 200, "Available modules fetched successfully", { modules });
        } catch (error) {
            next(error);
        }
    }

    async getPlans(req, res, next) {
        try {
            const plans = await SuperAdminService.getPlans();
            return sendSuccess(res, 200, "Subscription plans fetched successfully", { plans });
        } catch (error) {
            next(error);
        }
    }

    async createPlan(req, res, next) {
        try {
            const plan = await SuperAdminService.createPlan(req.body);
            return sendSuccess(res, 201, "Subscription plan created successfully", { plan });
        } catch (error) {
            next(error);
        }
    }

    async updatePlan(req, res, next) {
        try {
            const plan = await SuperAdminService.updatePlan(req.params.id, req.body);
            return sendSuccess(res, 200, "Subscription plan updated successfully", { plan });
        } catch (error) {
            next(error);
        }
    }

    async createSuperAdmin(req, res, next) {
        try {
            const { name, email, password } = req.body;
            const newAdmin = await SuperAdminService.createSuperAdmin({ name, email, password });
            newAdmin.password = undefined;

            return sendSuccess(res, 201, "Super Admin created successfully", { admin: newAdmin });
        } catch (error) {
            next(error);
        }
    }

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
