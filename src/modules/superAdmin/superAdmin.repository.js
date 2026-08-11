"use strict";

const { getMasterConnection } = require("../../config/masterDb");
const { getOperationsConnection } = require("../../config/operationsDb");

class SuperAdminRepository {
    async getDashboardStats() {
        const masterDb = getMasterConnection();
        const opsDb = getOperationsConnection();
        
        const Society = masterDb.model("Society");
        const User = opsDb.model("User");

        const totalSocieties = await Society.countDocuments();
        
        const activeResidents = await User.countDocuments({
            role: { $in: ["resident_owner", "resident_tenant"] },
            isActive: true
        });

        return {
            totalSocieties,
            activeResidents,
            // Basic placeholder formula for MRR ($50 per society)
            platformMRR: totalSocieties * 50,
            systemHealth: 99.9 // Static placeholder for now
        };
    }

    async getPaginatedSocieties(page = 1, limit = 10, search = "") {
        const masterDb = getMasterConnection();
        const Society = masterDb.model("Society");

        const query = {};
        if (search) {
            query.name = { $regex: search, $options: "i" };
        }

        const skip = (page - 1) * limit;

        const [societies, total] = await Promise.all([
            Society.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Society.countDocuments(query)
        ]);

        return {
            societies,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        };
    }

    async createSuperAdmin(adminData) {
        const masterDb = getMasterConnection();
        const SuperAdmin = masterDb.model("SuperAdmin");
        
        return SuperAdmin.create(adminData);
    }
}

module.exports = new SuperAdminRepository();
