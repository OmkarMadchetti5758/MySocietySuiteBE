"use strict";

const mongoose = require("mongoose");
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

    async getPaginatedSocieties(page = 1, limit = 10, search = "", filters = {}) {
        const masterDb = getMasterConnection();
        const Society = masterDb.model("Society");
        const opsDb = require("../../config/operationsDb").getOperationsConnection();
        const User = opsDb.model("User");

        const query = {};
        const andConditions = [];

        if (search) {
            andConditions.push({ name: { $regex: search, $options: "i" } });
        }

        if (filters.status && filters.status !== "all") {
            const s = filters.status.toLowerCase().trim();
            if (s === "pending_verification" || s === "pending") {
                let pendingAdminIds = [];
                let pendingSocietyIds = [];
                try {
                    const pendingAdmins = await User.find({
                        role: "admin",
                        status: { $in: ["invited", "pending", "pending_verification"] },
                    }).select("_id societyId").lean();

                    pendingAdminIds = pendingAdmins.map((u) => u._id).filter(Boolean);
                    pendingSocietyIds = pendingAdmins.map((u) => u.societyId).filter(Boolean);
                } catch (err) {
                    console.error("Error querying pending admins for status filter:", err.message);
                }

                const pendingOr = [
                    { status: { $in: ["pending_verification", "pending_approval"] } },
                ];
                if (pendingSocietyIds.length > 0) {
                    pendingOr.push({ _id: { $in: pendingSocietyIds } });
                }
                if (pendingAdminIds.length > 0) {
                    pendingOr.push({ adminId: { $in: pendingAdminIds } });
                }
                andConditions.push({ $or: pendingOr });
            } else if (s === "active" || s === "trial") {
                let pendingAdminIds = [];
                let pendingSocietyIds = [];
                try {
                    const pendingAdmins = await User.find({
                        role: "admin",
                        status: { $in: ["invited", "pending", "pending_verification"] },
                    }).select("_id societyId").lean();

                    pendingAdminIds = pendingAdmins.map((u) => u._id).filter(Boolean);
                    pendingSocietyIds = pendingAdmins.map((u) => u.societyId).filter(Boolean);
                } catch (err) {
                    console.error("Error querying pending admins for status filter:", err.message);
                }

                const condition = { status: s };
                if (pendingSocietyIds.length > 0) {
                    condition._id = { $nin: pendingSocietyIds };
                }
                if (pendingAdminIds.length > 0) {
                    condition.adminId = { $nin: pendingAdminIds };
                }
                andConditions.push(condition);
            } else if (s === "inactive") {
                andConditions.push({ status: "inactive" });
            } else {
                andConditions.push({ status: s });
            }
        }

        if (filters.plan && filters.plan !== "all") {
            const p = filters.plan.toLowerCase().trim();
            if (p === "trial") {
                andConditions.push({
                    $or: [
                        { subscriptionPlanId: null },
                        { subscriptionPlanId: { $exists: false } }
                    ]
                });
            } else if (p === "premium") {
                andConditions.push({ subscriptionPlanId: { $ne: null } });
            } else if (mongoose.Types.ObjectId.isValid(filters.plan)) {
                andConditions.push({ subscriptionPlanId: new mongoose.Types.ObjectId(filters.plan) });
            }
        }

        if (andConditions.length > 0) {
            query.$and = andConditions;
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

        const adminIds = societies.map((s) => s.adminId).filter(Boolean);
        const societyIds = societies.map((s) => s._id);

        const [adminsById, adminsBySociety] = await Promise.all([
            adminIds.length > 0 ? User.find({ _id: { $in: adminIds } }).select("_id name email mobile status").lean() : [],
            societyIds.length > 0 ? User.find({ societyId: { $in: societyIds }, role: "admin" }).select("_id societyId name email mobile status").lean() : [],
        ]);

        const adminMap = new Map();
        adminsById.forEach((a) => adminMap.set(String(a._id), a));
        const societyAdminMap = new Map();
        adminsBySociety.forEach((a) => societyAdminMap.set(String(a.societyId), a));

        const enrichedSocieties = societies.map((s) => {
            const admin = (s.adminId && adminMap.get(String(s.adminId))) || societyAdminMap.get(String(s._id));
            const adminStatus = admin?.status || "";
            return {
                ...s,
                adminName: admin?.name || "",
                adminStatus,
                isOnboarded: adminStatus === "active",
                contactEmail: s.contactEmail || admin?.email || "",
                contactPhone: s.contactPhone || admin?.mobile || "",
                adminDetails: admin
                    ? {
                          name: admin.name,
                          email: admin.email,
                          phone: admin.mobile,
                          status: admin.status,
                      }
                    : null,
            };
        });

        return {
            societies: enrichedSocieties,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        };
    }

    async getSocietyById(societyId) {
        const masterDb = getMasterConnection();
        const Society = masterDb.model("Society");

        const society = await Society.findById(societyId)
            .populate("subscriptionPlanId", "name slug price features tagline")
            .lean();

        if (!society) return null;

        const opsDb = require("../../config/operationsDb").getOperationsConnection();
        const User = opsDb.model("User");

        let admin = null;
        if (society.adminId) {
            admin = await User.findById(society.adminId).select("_id name email mobile status").lean();
        }
        if (!admin) {
            admin = await User.findOne({ societyId: society._id, role: "admin" }).select("_id name email mobile status").lean();
        }

        const adminStatus = admin?.status || "";
        return {
            ...society,
            adminName: admin?.name || "",
            adminStatus,
            isOnboarded: adminStatus === "active",
            contactEmail: society.contactEmail || admin?.email || "",
            contactPhone: society.contactPhone || admin?.mobile || "",
            adminDetails: admin
                ? {
                      name: admin.name,
                      email: admin.email,
                      phone: admin.mobile,
                      status: admin.status,
                  }
                : null,
        };
    }

    async updateSociety(societyId, { societyDetails = {}, adminDetails = {} }) {
        const masterDb = getMasterConnection();
        const opsDb = require("../../config/operationsDb").getOperationsConnection();
        const Society = masterDb.model("Society");
        const User = opsDb.model("User");
        const AppError = require("../../common/AppError");

        const society = await Society.findById(societyId);
        if (!society) {
            throw new AppError("Society not found", 404);
        }

        // Update society details
        if (societyDetails.name !== undefined) {
            const trimmedName = societyDetails.name.trim();
            if (!trimmedName) throw new AppError("Society name is required", 400);
            society.name = trimmedName;
        }

        if (societyDetails.city !== undefined || societyDetails.state !== undefined) {
            society.address = society.address || {};
            if (societyDetails.city !== undefined) society.address.city = societyDetails.city.trim();
            if (societyDetails.state !== undefined) society.address.state = societyDetails.state.trim();
        }

        if (adminDetails.email !== undefined) {
            const email = adminDetails.email.trim().toLowerCase();
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                throw new AppError("Please enter a valid email address", 400);
            }
            society.contactEmail = email;
        }

        if (adminDetails.phone !== undefined) {
            const phone = adminDetails.phone.trim();
            if (phone && !/^\+?[0-9\s-]{10,15}$/.test(phone)) {
                throw new AppError("Please enter a valid phone number", 400);
            }
            society.contactPhone = phone;
        }

        if (societyDetails.status !== undefined) {
            if (["active", "trial"].includes(societyDetails.status)) {
                let existingAdmin = null;
                if (society.adminId) {
                    existingAdmin = await User.findById(society.adminId);
                }
                if (!existingAdmin) {
                    existingAdmin = await User.findOne({ societyId: society._id, role: "admin" });
                }
                if (existingAdmin && existingAdmin.status === "invited") {
                    throw new AppError(
                        "Cannot activate a society whose admin has not completed the onboarding invitation flow.",
                        400
                    );
                }
                if (["pending_verification", "pending_approval"].includes(society.status)) {
                    throw new AppError(
                        "Cannot activate a pending society. The society admin must complete the onboarding invitation flow first.",
                        400
                    );
                }
            }
            society.status = societyDetails.status;
        }

        await society.save();

        // Find or create admin user in opsDb
        let adminUser = null;
        if (society.adminId) {
            adminUser = await User.findById(society.adminId);
        }
        if (!adminUser) {
            adminUser = await User.findOne({ societyId: society._id, role: "admin" });
        }

        if (adminUser) {
            const oldEmail = adminUser.email;
            const oldMobile = adminUser.mobile;

            if (adminDetails.name !== undefined) {
                const trimmedName = adminDetails.name.trim();
                if (!trimmedName) throw new AppError("Admin name is required", 400);
                adminUser.name = trimmedName;
            }

            if (adminDetails.email !== undefined) {
                adminUser.email = adminDetails.email.trim().toLowerCase();
            }

            if (adminDetails.phone !== undefined) {
                adminUser.mobile = adminDetails.phone.trim();
            }

            await adminUser.save();

            // Link adminId to Society if missing
            if (!society.adminId) {
                society.adminId = adminUser._id;
                await society.save();
            }

            // Sync UserSocietyMapping if email or mobile changed
            const emailChanged = adminDetails.email && adminDetails.email.trim().toLowerCase() !== oldEmail;
            const mobileChanged = adminDetails.phone && adminDetails.phone.trim() !== oldMobile;

            if (emailChanged || mobileChanged) {
                const MappingRepository = require("../userSocietyMapping/userSocietyMapping.repository");
                const Mapping = masterDb.model("UserSocietyMapping");

                const newIdentifiers = MappingRepository.collectIdentifiers(adminUser.email, adminUser.mobile);

                // Remove mappings for this admin user that no longer match the new identifiers
                await Mapping.deleteMany({
                    societyId: society._id,
                    userId: adminUser._id,
                    identifier: { $nin: newIdentifiers },
                });

                // Ensure new identifiers are mapped
                await MappingRepository.ensureIdentifierMappings(society._id, adminUser, {
                    roleKeys: ["admin"],
                    status: society.status === "active" ? "active" : "deactivated",
                });
            }
        } else if (adminDetails.name || adminDetails.email || adminDetails.phone) {
            // Admin user did not exist, create one
            const newAdminUser = await User.create({
                societyId: society._id,
                name: adminDetails.name ? adminDetails.name.trim() : "Admin",
                email: (adminDetails.email || society.contactEmail || "").trim().toLowerCase(),
                mobile: (adminDetails.phone || society.contactPhone || "").trim(),
                role: "admin",
                status: "active",
            });

            society.adminId = newAdminUser._id;
            await society.save();

            const MappingRepository = require("../userSocietyMapping/userSocietyMapping.repository");
            await MappingRepository.createMappings({
                societyId: society._id,
                userId: newAdminUser._id,
                email: newAdminUser.email,
                mobile: newAdminUser.mobile,
                roleKeys: ["admin"],
            });
            adminUser = newAdminUser;
        }

        return this.getSocietyById(society._id);
    }

    async updateSocietyStatus(societyId, status) {
        const masterDb = getMasterConnection();
        const Society = masterDb.model("Society");
        const AppError = require("../../common/AppError");

        const society = await Society.findById(societyId);
        if (!society) {
            throw new AppError("Society not found", 404);
        }

        if (["pending_verification", "pending_approval"].includes(society.status)) {
            throw new AppError(
                "Cannot change status of a pending society. The society admin must complete the onboarding invitation flow first.",
                400
            );
        }

        const opsDb = require("../../config/operationsDb").getOperationsConnection();
        const User = opsDb.model("User");
        let adminUser = null;
        if (society.adminId) {
            adminUser = await User.findById(society.adminId);
        }
        if (!adminUser) {
            adminUser = await User.findOne({ societyId: society._id, role: "admin" });
        }

        if (adminUser && adminUser.status === "invited") {
            throw new AppError(
                "Cannot change status of a society whose admin has not completed the onboarding invitation flow.",
                400
            );
        }

        society.status = status;
        await society.save();

        const Mapping = masterDb.model("UserSocietyMapping");
        const mappingStatus = status === "active" ? "active" : "deactivated";
        await Mapping.updateMany({ societyId: society._id }, { $set: { status: mappingStatus } });

        return this.getSocietyById(society._id);
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
        let planId = subscriptionPlanId || societyData?.subscriptionPlanId;
        let plan = null;
        if (planId) {
            if (mongoose.Types.ObjectId.isValid(planId)) {
                plan = await SubscriptionPlan.findById(planId);
            } else if (typeof planId === "string") {
                const slug = planId.replace("-fallback", "").toLowerCase().trim();
                plan = await SubscriptionPlan.findOne({ slug });
            }
        }
        if (!plan) {
            // Default to Basic if not specified or not found
            plan = await SubscriptionPlan.findOne({ slug: "basic" }) || 
                   await SubscriptionPlan.findOne({ isActive: true }) || 
                   await SubscriptionPlan.findOne();
        }
        if (!plan) {
            // Auto-seed if plans don't exist yet
            try {
                const seedSubscriptionPlans = require("../../scripts/seedSubscriptionPlans");
                const planMap = await seedSubscriptionPlans();
                plan = planMap["basic"] || planMap["advanced"];
            } catch (seedErr) {
                console.error("Auto-seed subscription plans error:", seedErr.message);
            }
        }
        if (plan) {
            planId = plan._id;
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

    async getActiveModules() {
        const masterDb = getMasterConnection();
        const Module = masterDb.model("Module");
        return Module.find({ isActive: true })
            .sort({ sortOrder: 1, name: 1 })
            .lean();
    }

    async findActiveModulesByIds(moduleIds) {
        const masterDb = getMasterConnection();
        const Module = masterDb.model("Module");
        return Module.find({ _id: { $in: moduleIds }, isActive: true }).lean();
    }

    async getAllPlans() {
        const masterDb = getMasterConnection();
        const SubscriptionPlan = masterDb.model("SubscriptionPlan");
        return SubscriptionPlan.find()
            .sort({ sortOrder: 1, createdAt: 1 })
            .populate({
                path: "modules",
                select: "_id key name description icon category sortOrder isActive",
            })
            .populate({
                path: "inheritsFrom",
                select: "_id name slug badge badgeType",
            })
            .lean();
    }

    async getPlanById(planId) {
        const masterDb = getMasterConnection();
        const SubscriptionPlan = masterDb.model("SubscriptionPlan");
        return SubscriptionPlan.findById(planId)
            .populate({
                path: "modules",
                select: "_id key name description icon category sortOrder isActive",
            })
            .populate({
                path: "inheritsFrom",
                select: "_id name slug badge badgeType",
            });
    }

    async getPlanBySlugOrName(slug, name, excludeId = null) {
        const masterDb = getMasterConnection();
        const SubscriptionPlan = masterDb.model("SubscriptionPlan");
        const conditions = [];
        if (slug) {
            conditions.push({ slug: slug.toLowerCase() });
        }
        if (name) {
            conditions.push({ name: { $regex: `^${name.trim()}$`, $options: "i" } });
        }
        if (conditions.length === 0) return null;

        const query = { $or: conditions };
        if (excludeId) {
            query._id = { $ne: excludeId };
        }
        return SubscriptionPlan.findOne(query).lean();
    }

    async createPlan(planData) {
        const masterDb = getMasterConnection();
        const SubscriptionPlan = masterDb.model("SubscriptionPlan");
        const created = await SubscriptionPlan.create(planData);
        return this.getPlanById(created._id);
    }

    async updatePlan(planId, updateData) {
        const masterDb = getMasterConnection();
        const SubscriptionPlan = masterDb.model("SubscriptionPlan");
        await SubscriptionPlan.findByIdAndUpdate(planId, { $set: updateData }, { new: true, runValidators: true });
        return this.getPlanById(planId);
    }
}

module.exports = new SuperAdminRepository();
