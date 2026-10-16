"use strict";

const SuperAdminRepository = require("./superAdmin.repository");
const emailService = require("../../services/email.service");
const { FRONTEND_URL } = require("../../config/env");

class SuperAdminService {
    async getDashboardStats() {
        return SuperAdminRepository.getDashboardStats();
    }

    async getSocieties(page, limit, search) {
        // Parse and validate pagination
        const p = parseInt(page) || 1;
        const l = parseInt(limit) || 10;

        return SuperAdminRepository.getPaginatedSocieties(p, l, search);
    }

    async getSubscriptionPlans() {
        return SuperAdminRepository.getSubscriptionPlans();
    }

    async createSuperAdmin(data) {
        return SuperAdminRepository.createSuperAdmin(data);
    }

    async createSociety(data) {
        const { societyDetails, adminDetails, subscriptionPlanId } = data;
        const planId = subscriptionPlanId || societyDetails?.subscriptionPlanId;

        const result = await SuperAdminRepository.createSocietyWithAdmin(societyDetails, adminDetails, planId);

        // Construct the activation link
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
            // Only return devInviteLink if not in production
            ...(process.env.NODE_ENV === 'development' ? { devInviteLink: inviteLink } : {})
        };
    }
}

module.exports = new SuperAdminService();
