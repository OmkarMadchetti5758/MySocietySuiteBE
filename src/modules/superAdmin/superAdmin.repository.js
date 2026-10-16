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

    async getSubscriptionPlans() {
        const masterDb = getMasterConnection();
        const SubscriptionPlan = masterDb.model("SubscriptionPlan");
        return SubscriptionPlan.find({ isActive: true }).sort({ price: 1 }).lean();
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
                .populate("subscriptionPlanId", "name slug price features tagline")
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

    async createSocietyWithAdmin(societyData, adminData, subscriptionPlanId) {
        const masterDb = getMasterConnection();
        const opsDb = require("../../config/operationsDb").getOperationsConnection();
        
        const Society = masterDb.model("Society");
        const User = opsDb.model("User");
        const InviteToken = masterDb.model("InviteToken");
        const SubscriptionPlan = masterDb.model("SubscriptionPlan");
        const Subscription = masterDb.model("Subscription");

        // Resolve plan
        let planId = subscriptionPlanId || societyData.subscriptionPlanId;
        let plan = null;
        if (planId) {
            plan = await SubscriptionPlan.findById(planId);
        }
        if (!plan) {
            // Default to Basic if not specified
            plan = await SubscriptionPlan.findOne({ slug: "basic" }) || await SubscriptionPlan.findOne();
            if (plan) planId = plan._id;
        }

        // 1. Create Society (PENDING_VERIFICATION)
        const society = await Society.create([{
            name: societyData.name,
            address: {
                city: societyData.city,
                state: societyData.state,
            },
            contactEmail: adminData.email,
            contactPhone: adminData.phone,
            status: "pending_verification",
            subscriptionPlanId: planId || null,
        }]);

        const newSocietyId = society[0]._id;

        // Create active subscription entry
        if (plan) {
            const endDate = new Date();
            endDate.setMonth(endDate.getMonth() + (plan.durationInMonths || 12));
            await Subscription.create([{
                societyId: newSocietyId,
                planId: plan._id,
                startDate: new Date(),
                endDate,
                status: "active",
                amountPaid: plan.price || 0,
            }]);
        }

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

        const MappingRepository = require("../userSocietyMapping/userSocietyMapping.repository");
        await MappingRepository.createMappings({
            societyId: newSocietyId,
            userId: newAdminId,
            email: adminData.email,
            mobile: adminData.phone,
            roleKeys: ["admin"],
        });

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
