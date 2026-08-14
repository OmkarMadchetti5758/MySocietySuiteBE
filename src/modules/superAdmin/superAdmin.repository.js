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

    async createSocietyWithAdmin(societyData, adminData) {
        const masterDb = getMasterConnection();
        const opsDb = require("../../config/operationsDb").getOperationsConnection();
        
        const Society = masterDb.model("Society");
        const User = opsDb.model("User");
        const InviteToken = masterDb.model("InviteToken");
        const UserSocietyMapping = masterDb.model("UserSocietyMapping");

        // 1. Create Society (PENDING_VERIFICATION)
        const society = await Society.create([{
            name: societyData.name,
            address: {
                city: societyData.city,
                state: societyData.state,
            },
            contactEmail: adminData.email,
            contactPhone: adminData.phone,
            status: "pending_verification"
        }]);

        const newSocietyId = society[0]._id;

        // 2. Create User in Ops DB (INVITED)
        const adminUser = await User.create([{
            societyId: newSocietyId,
            name: adminData.name,
            email: adminData.email,
            mobile: adminData.phone,
            role: "admin",
            status: "invited"
        }]);

        const newAdminId = adminUser[0]._id;

        // 3. Update Society with adminId
        await Society.findByIdAndUpdate(newSocietyId, { adminId: newAdminId });

        // 4. Create UserSocietyMapping for login resolution later
        await UserSocietyMapping.create([{
            identifier: adminData.email,
            societyId: newSocietyId,
            userId: newAdminId,
            roleKeys: ["admin"],
        }]);
        await UserSocietyMapping.create([{
            identifier: adminData.phone,
            societyId: newSocietyId,
            userId: newAdminId,
            roleKeys: ["admin"],
        }]);

        // 5. Generate and store Invite Token (24 hours expiry)
        const { plainToken, tokenHash } = InviteToken.generateToken();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);

        await InviteToken.create([{
            tokenHash,
            societyId: newSocietyId,
            adminId: newAdminId,
            expiresAt
        }]);

        return {
            society: society[0],
            admin: adminUser[0],
            plainToken // Return plain token so service can format the invite link
        };
    }
}

module.exports = new SuperAdminRepository();
