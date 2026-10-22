"use strict";

const mongoose = require("mongoose");
const SuperAdminRepository = require("./superAdmin.repository");
const emailService = require("../../services/email.service");
const { FRONTEND_URL } = require("../../config/env");
const { getAvailableModules: getFallbackModules } = require("../../common/moduleRegistry");

class SuperAdminService {
    async getDashboardStats() {
        return SuperAdminRepository.getDashboardStats();
    }

    async getSocieties(page, limit, search) {
        const p = parseInt(page) || 1;
        const l = parseInt(limit) || 10;
        return SuperAdminRepository.getPaginatedSocieties(p, l, search);
    }

    async getAvailableModules() {
        const dbModules = await SuperAdminRepository.getActiveModules();
        if (dbModules && dbModules.length > 0) {
            return dbModules;
        }
        return getFallbackModules();
    }

    async getPlans() {
        const plans = await SuperAdminRepository.getAllPlans();
        return plans.map((p) => {
            if (Array.isArray(p.modules)) {
                p.modules = p.modules.filter(Boolean);
            }
            return p;
        });
    }

    async validateModules(moduleIds = []) {
        if (!Array.isArray(moduleIds)) {
            const err = new Error("Modules must be an array of module IDs.");
            err.statusCode = 400;
            throw err;
        }

        if (moduleIds.length === 0) return;

        for (const id of moduleIds) {
            if (!mongoose.Types.ObjectId.isValid(id)) {
                const err = new Error(`Invalid module ID: ${id}`);
                err.statusCode = 400;
                throw err;
            }
        }

        const activeModules = await SuperAdminRepository.findActiveModulesByIds(moduleIds);
        if (activeModules.length !== moduleIds.length) {
            const err = new Error("One or more selected modules are invalid or inactive.");
            err.statusCode = 400;
            throw err;
        }
    }

    async validateInheritance(planId, inheritsFromId) {
        if (!inheritsFromId) return null;

        if (!mongoose.Types.ObjectId.isValid(inheritsFromId)) {
            const err = new Error("Invalid inheritsFrom plan ID.");
            err.statusCode = 400;
            throw err;
        }

        if (planId && inheritsFromId.toString() === planId.toString()) {
            const err = new Error("A plan cannot inherit from itself.");
            err.statusCode = 400;
            throw err;
        }

        const parent = await SuperAdminRepository.getPlanById(inheritsFromId);
        if (!parent) {
            const err = new Error("Inherited plan not found.");
            err.statusCode = 400;
            throw err;
        }

        // Circular inheritance detection
        const visited = new Set();
        if (planId) {
            visited.add(planId.toString());
        }

        let curr = parent;
        while (curr && curr.inheritsFrom) {
            const parentId = curr.inheritsFrom._id
                ? curr.inheritsFrom._id.toString()
                : curr.inheritsFrom.toString();

            if (visited.has(parentId)) {
                const err = new Error("Circular inheritance detected in plan hierarchy.");
                err.statusCode = 400;
                throw err;
            }

            visited.add(parentId);
            curr = await SuperAdminRepository.getPlanById(parentId);
        }

        return inheritsFromId;
    }

    async createPlan(data) {
        if (!data.name || !data.name.trim()) {
            const err = new Error("Plan name is required.");
            err.statusCode = 400;
            throw err;
        }

        if (data.price === undefined || data.price === null || isNaN(data.price) || Number(data.price) < 0) {
            const err = new Error("A valid plan price (>= 0) is required.");
            err.statusCode = 400;
            throw err;
        }

        const slug = (data.slug || data.name)
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "");

        const existing = await SuperAdminRepository.getPlanBySlugOrName(slug, data.name);
        if (existing) {
            const err = new Error(`A plan with the name "${data.name}" or slug "${slug}" already exists.`);
            err.statusCode = 400;
            throw err;
        }

        await this.validateInheritance(null, data.inheritsFrom);
        await this.validateModules(data.modules || []);

        const planPayload = {
            name: data.name.trim(),
            slug,
            badge: data.badge ? data.badge.trim() : "",
            badgeType: data.badgeType || "blue",
            description: data.description ? data.description.trim() : "",
            price: Number(data.price) || 0,
            durationInMonths: Number(data.durationInMonths) || 12,
            maxFlats: Number(data.maxFlats) || 0,
            maxUsers: Number(data.maxUsers) || 0,
            features: Array.isArray(data.features) ? data.features : [],
            modules: data.modules || [],
            inheritsFrom: data.inheritsFrom || null,
            sortOrder: Number(data.sortOrder) || 0,
            isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
        };

        return SuperAdminRepository.createPlan(planPayload);
    }

    async updatePlan(id, data) {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            const err = new Error("Invalid plan ID.");
            err.statusCode = 400;
            throw err;
        }

        const existingPlan = await SuperAdminRepository.getPlanById(id);
        if (!existingPlan) {
            const err = new Error("Subscription plan not found.");
            err.statusCode = 404;
            throw err;
        }

        const updatePayload = {};

        if (data.name !== undefined) {
            if (!data.name.trim()) {
                const err = new Error("Plan name cannot be empty.");
                err.statusCode = 400;
                throw err;
            }
            updatePayload.name = data.name.trim();
        }

        if (data.slug !== undefined || data.name !== undefined) {
            const candidateSlug = (data.slug || updatePayload.name || existingPlan.slug)
                .toLowerCase()
                .trim()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/(^-|-$)/g, "");

            const conflict = await SuperAdminRepository.getPlanBySlugOrName(
                candidateSlug,
                updatePayload.name || existingPlan.name,
                id
            );

            if (conflict) {
                const err = new Error("Another plan with this name or slug already exists.");
                err.statusCode = 400;
                throw err;
            }
            updatePayload.slug = candidateSlug;
        }

        if (data.price !== undefined) {
            if (isNaN(data.price) || Number(data.price) < 0) {
                const err = new Error("A valid plan price (>= 0) is required.");
                err.statusCode = 400;
                throw err;
            }
            updatePayload.price = Number(data.price);
        }

        if (data.durationInMonths !== undefined) {
            updatePayload.durationInMonths = Number(data.durationInMonths) || 12;
        }

        if (data.badge !== undefined) {
            updatePayload.badge = data.badge ? data.badge.trim() : "";
        }

        if (data.badgeType !== undefined) {
            updatePayload.badgeType = data.badgeType;
        }

        if (data.description !== undefined) {
            updatePayload.description = data.description ? data.description.trim() : "";
        }

        if (data.sortOrder !== undefined) {
            updatePayload.sortOrder = Number(data.sortOrder) || 0;
        }

        if (data.isActive !== undefined) {
            updatePayload.isActive = Boolean(data.isActive);
        }

        if (data.modules !== undefined) {
            await this.validateModules(data.modules);
            updatePayload.modules = data.modules;
        }

        if (data.inheritsFrom !== undefined) {
            await this.validateInheritance(id, data.inheritsFrom);
            updatePayload.inheritsFrom = data.inheritsFrom || null;
        }

        return SuperAdminRepository.updatePlan(id, updatePayload);
    }

    async getEffectiveModules(planId) {
        if (!mongoose.Types.ObjectId.isValid(planId)) {
            const err = new Error("Invalid plan ID.");
            err.statusCode = 400;
            throw err;
        }

        const plan = await SuperAdminRepository.getPlanById(planId);
        if (!plan) {
            const err = new Error("Plan not found.");
            err.statusCode = 404;
            throw err;
        }

        const effectiveMap = new Map();

        // Collect own modules
        for (const mod of plan.modules || []) {
            if (mod && mod._id) {
                effectiveMap.set(mod._id.toString(), mod);
            }
        }

        // Traverse inherited chain
        const visited = new Set([plan._id.toString()]);
        let curr = plan;

        while (curr && curr.inheritsFrom) {
            const parentId = curr.inheritsFrom._id
                ? curr.inheritsFrom._id.toString()
                : curr.inheritsFrom.toString();

            if (visited.has(parentId)) break;
            visited.add(parentId);

            curr = await SuperAdminRepository.getPlanById(parentId);
            if (curr && Array.isArray(curr.modules)) {
                for (const mod of curr.modules) {
                    if (mod && mod._id && !effectiveMap.has(mod._id.toString())) {
                        effectiveMap.set(mod._id.toString(), mod);
                    }
                }
            }
        }

        return Array.from(effectiveMap.values());
    }

    async createSuperAdmin(data) {
        return SuperAdminRepository.createSuperAdmin(data);
    }

    async createSociety(data) {
        const { societyDetails, adminDetails } = data;
        const result = await SuperAdminRepository.createSocietyWithAdmin(societyDetails, adminDetails);

        const frontendUrl = FRONTEND_URL;
        const inviteLink = `${frontendUrl}/activate-account?token=${result.plainToken}`;

        await emailService.sendInviteEmail({
            to: result.admin.email,
            recipientName: result.admin.name,
            roleLabel: "Society Admin",
            societyName: result.society.name,
            inviteLink,
        });

        if (process.env.NODE_ENV === "development") {
            console.log("\n=============================================");
            console.log("=== DEV INVITE LINK ===");
            console.log(`Society: ${result.society.name}`);
            console.log(`Admin: ${result.admin.name} (${result.admin.email})`);
            console.log(`Link: ${inviteLink}`);
            console.log("=============================================\n");
        }

        return {
            society: result.society,
            admin: result.admin,
            ...(process.env.NODE_ENV === "development" ? { devInviteLink: inviteLink } : {}),
        };
    }
}

module.exports = new SuperAdminService();
