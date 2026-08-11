"use strict";

const SuperAdminRepository = require("./superAdmin.repository");

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

    async createSuperAdmin(data) {
        return SuperAdminRepository.createSuperAdmin(data);
    }

    async createSociety(data) {
        const { societyDetails, adminDetails } = data;
        
        const result = await SuperAdminRepository.createSocietyWithAdmin(societyDetails, adminDetails);
        
        // Construct the activation link
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
        const inviteLink = `${frontendUrl}/activate-account?token=${result.plainToken}`;

        // Log to console for development
        console.log("\n=============================================");
        console.log("=== DEV INVITE LINK ===");
        console.log(`Society: ${result.society.name}`);
        console.log(`Admin: ${result.admin.name} (${result.admin.email})`);
        console.log(`Link: ${inviteLink}`);
        console.log("=============================================\n");

        return {
            society: result.society,
            admin: result.admin,
            // Only return devInviteLink if not in production
            ...(process.env.NODE_ENV === 'development' ? { devInviteLink: inviteLink } : {})
        };
    }
}

module.exports = new SuperAdminService();
