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
}

module.exports = new SuperAdminService();
