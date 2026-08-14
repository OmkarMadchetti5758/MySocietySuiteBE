"use strict";

const { getMasterConnection } = require("../../config/masterDb");
const { getOperationsConnection } = require("../../config/operationsDb");
const { ROLES, RESIDENT_TYPE, FLAT_STATUS, USER_STATUS } = require("../../common/constants");

class ResidentRepository {
    async findOrCreateFlat(societyId, flatNumber, wingCode) {
        const opsDb = getOperationsConnection();
        const Flat = opsDb.model("Flat");
        const Block = opsDb.model("Block");

        const displayFlatNumber = wingCode ? `${wingCode}-${flatNumber}` : flatNumber;

        let flat = await Flat.findOne({ societyId, flatNumber: displayFlatNumber });
        if (flat) return flat;

        let blockDoc = await Block.findOne({ societyId });
        if (!blockDoc) {
            blockDoc = await Block.create({ societyId, wings: [] });
        }

        flat = await Flat.create({
            societyId,
            blockId: blockDoc._id,
            flatNumber: displayFlatNumber,
            status: FLAT_STATUS.OCCUPIED,
        });

        return flat;
    }

    async createResidentWithInvite(societyId, data) {
        const masterDb = getMasterConnection();
        const opsDb = getOperationsConnection();

        const User = opsDb.model("User");
        const Resident = opsDb.model("Resident");
        const InviteToken = masterDb.model("InviteToken");
        const UserSocietyMapping = masterDb.model("UserSocietyMapping");

        const role = data.role || ROLES.RESIDENT_OWNER;
        const residentType = data.residentType || RESIDENT_TYPE.OWNER;
        const email = data.email.toLowerCase().trim();
        const phone = data.phone.trim();

        const flat = await this.findOrCreateFlat(societyId, data.flatNumber, data.wingCode);

        let user;
        let resident;
        try {
            user = await User.create({
                societyId,
                name: data.name,
                email,
                mobile: phone,
                role,
                status: USER_STATUS.INVITED,
            });

            resident = await Resident.create({
                societyId,
                flatId: flat._id,
                userId: user._id,
                residentType,
                isActive: true,
            });

            const mappingEntries = [];
            if (email) {
                mappingEntries.push({
                    identifier: email,
                    societyId,
                    userId: user._id,
                    roleKeys: [role],
                    flatId: flat._id,
                });
            }
            if (phone && phone !== email) {
                mappingEntries.push({
                    identifier: phone,
                    societyId,
                    userId: user._id,
                    roleKeys: [role],
                    flatId: flat._id,
                });
            }
            if (mappingEntries.length > 0) {
                await UserSocietyMapping.insertMany(mappingEntries);
            }

            const { plainToken, tokenHash } = InviteToken.generateToken();
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 24);

            await InviteToken.create({
                tokenHash,
                societyId,
                adminId: user._id,
                expiresAt,
            });

            return { user, flat, plainToken };
        } catch (error) {
            if (user?._id) {
                await Resident.deleteOne({ userId: user._id, societyId }).catch(() => {});
                await User.deleteOne({ _id: user._id }).catch(() => {});
            }
            throw error;
        }
    }

    async findExistingUser(societyId, email, phone) {
        const opsDb = getOperationsConnection();
        const User = opsDb.model("User");

        const conditions = [];
        if (email) conditions.push({ email: email.toLowerCase().trim() });
        if (phone) conditions.push({ mobile: phone.trim() });

        if (conditions.length === 0) return null;

        return User.findOne({ societyId, $or: conditions }).lean();
    }

    async getPaginatedResidents(societyId, page, limit, search) {
        const opsDb = getOperationsConnection();
        const User = opsDb.model("User");
        const Resident = opsDb.model("Resident");
        const Flat = opsDb.model("Flat");

        const residentRoles = [ROLES.RESIDENT_OWNER, ROLES.RESIDENT_TENANT, ROLES.RESIDENT];
        const userFilter = { societyId, role: { $in: residentRoles } };

        if (search) {
            const regex = { $regex: search, $options: "i" };
            userFilter.$or = [{ name: regex }, { email: regex }, { mobile: regex }];
        }

        const skip = (page - 1) * limit;

        const [users, total] = await Promise.all([
            User.find(userFilter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            User.countDocuments(userFilter),
        ]);

        const userIds = users.map((u) => u._id);
        const residents = await Resident.find({ societyId, userId: { $in: userIds } }).lean();

        const flatIds = residents.map((r) => r.flatId);
        const flats = await Flat.find({ _id: { $in: flatIds } }).lean();
        const flatMap = Object.fromEntries(flats.map((f) => [f._id.toString(), f]));

        const residentMap = Object.fromEntries(residents.map((r) => [r.userId.toString(), r]));

        const rows = users.map((user) => {
            const resident = residentMap[user._id.toString()];
            const flat = resident ? flatMap[resident.flatId?.toString()] : null;
            return {
                _id: user._id,
                name: user.name,
                email: user.email,
                mobile: user.mobile,
                role: user.role,
                status: user.status,
                isActive: user.isActive,
                flatNumber: flat?.flatNumber || null,
                residentType: resident?.residentType || null,
                createdAt: user.createdAt,
            };
        });

        return {
            residents: rows,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 1,
        };
    }
}

module.exports = new ResidentRepository();
