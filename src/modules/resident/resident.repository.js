"use strict";

const { getMasterConnection } = require("../../config/masterDb");
const { getOperationsConnection } = require("../../config/operationsDb");
const AppError = require("../../common/AppError");
const { ROLES, RESIDENT_TYPE, USER_STATUS, FLAT_STATUS } = require("../../common/constants");
const { RESIDENT_ERRORS } = require("./resident.constants");

class ResidentRepository {
    /**
     * Keep Flat occupancy fields in sync with active Resident records.
     * Invite, allocate, and rollback all use this so Society & Flats never
     * stays "Vacant" after a resident is assigned.
     */
    async syncFlatOccupancy(societyId, flatId, extras = {}) {
        if (!flatId) return null;

        const opsDb = getOperationsConnection();
        const Flat = opsDb.model("Flat");
        const Resident = opsDb.model("Resident");
        const User = opsDb.model("User");

        const residents = await Resident.find({
            societyId,
            flatId,
            isActive: true,
        }).lean();

        const owner = residents.find((r) => r.residentType === RESIDENT_TYPE.OWNER);
        const tenant = residents.find((r) => r.residentType === RESIDENT_TYPE.TENANT);

        const updates = {
            numberOfResidents: residents.length,
            primaryOwner: owner?.userId || null,
            activeTenant: tenant?.userId || null,
        };

        if (residents.length === 0) {
            updates.status = FLAT_STATUS.VACANT;
            updates.occupancyStatus = "Vacant";
            if (extras.clearOwnerOnVacant) {
                updates.ownerName = "";
                updates.ownerContact = "";
            }
        } else {
            updates.status = FLAT_STATUS.OCCUPIED;
            updates.occupancyStatus = tenant && !owner ? "Tenant Occupied" : "Owner Occupied";

            const displayUserId = owner?.userId || tenant?.userId || residents[0].userId;
            const displayUser = displayUserId
                ? await User.findById(displayUserId).select("name mobile").lean()
                : null;

            if (extras.ownerName || displayUser?.name) {
                updates.ownerName = extras.ownerName || displayUser.name;
            }
            if (extras.ownerContact || displayUser?.mobile) {
                updates.ownerContact = extras.ownerContact || displayUser.mobile;
            }
        }

        return Flat.findOneAndUpdate(
            { _id: flatId, societyId },
            { $set: updates },
            { new: true, runValidators: true }
        );
    }

    async findExistingFlat(societyId, { flatId, flatNumber, blockId, wingCode }) {
        const opsDb = getOperationsConnection();
        const Flat = opsDb.model("Flat");
        const Block = opsDb.model("Block");

        if (flatId) {
            const flat = await Flat.findOne({ _id: flatId, societyId });
            if (!flat) {
                throw new AppError(RESIDENT_ERRORS.FLAT_NOT_FOUND, 404);
            }
            return { flat, created: false };
        }

        const trimmedFlatNumber = String(flatNumber || "").trim();
        if (!trimmedFlatNumber) {
            throw new AppError(RESIDENT_ERRORS.FLAT_REQUIRED, 400);
        }

        const blockDoc = await Block.findOne({ societyId }).lean();
        let targetBlockId = blockId;

        if (!targetBlockId && wingCode && blockDoc?.wings?.length) {
            const matchedWing = blockDoc.wings.find(
                (wing) => wing.code === wingCode || wing.name === wingCode
            );
            targetBlockId = matchedWing?._id || null;
        }

        if (!targetBlockId) {
            throw new AppError(RESIDENT_ERRORS.WING_REQUIRED, 400);
        }

        const existingFlat = await Flat.findOne({
            societyId,
            blockId: targetBlockId,
            flatNumber: trimmedFlatNumber,
        }).lean();

        if (existingFlat) {
            return { flat: existingFlat, created: false };
        }

        const flat = await Flat.create({
            societyId,
            blockId: targetBlockId,
            flatNumber: trimmedFlatNumber,
            status: FLAT_STATUS.OCCUPIED,
        });

        return { flat, created: true };
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

        const { flat, created: createdFlat } = await this.findExistingFlat(societyId, {
            flatId: data.flatId,
            flatNumber: data.flatNumber,
            blockId: data.blockId,
            wingCode: data.wingCode,
        });

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
                moveInDate: new Date(),
            });

            // Update flat's ownerName so it shows correctly in the Guard's Walk-in Visitor dropdown
            const Flat = opsDb.model("Flat");
            const isOwner = residentType === RESIDENT_TYPE.OWNER;
            await Flat.findOneAndUpdate(
                { _id: flat._id },
                {
                    $set: {
                        status: FLAT_STATUS.OCCUPIED,
                        occupancyStatus: isOwner ? "Owner Occupied" : "Tenant Occupied",
                        ownerName: isOwner ? data.name : flat.ownerName || data.name,
                    }
                }
            );


            const mappingEntries = [];
            if (email) {
                mappingEntries.push({
                    identifier: email,
                    societyId,
                    userId: user._id,
                    roleKeys: [role],
                    flatId: flat._id,
                });
            } else if (phone) {
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
            await this.syncFlatOccupancy(societyId, flat._id, {
                ownerName: residentType === RESIDENT_TYPE.OWNER ? data.name : undefined,
                ownerContact: residentType === RESIDENT_TYPE.OWNER ? phone : undefined,
            });

            const MappingRepository = require("../userSocietyMapping/userSocietyMapping.repository");
            await MappingRepository.createMappings({
                societyId,
                userId: user._id,
                email,
                mobile: phone,
                roleKeys: [role],
                flatId: flat._id,
            });

            const { plainToken, tokenHash } = InviteToken.generateToken();
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 24);

            await InviteToken.create({
                tokenHash,
                societyId,
                adminId: user._id,
                purpose: "resident",
                expiresAt,
            });

            const updatedFlat = await opsDb.model("Flat").findById(flat._id);
            return { user, flat: updatedFlat || flat, plainToken, createdFlat };
        } catch (error) {
            if (user?._id) {
                await this.rollbackResidentInvite(societyId, {
                    userId: user._id,
                    flatId: flat?._id,
                    createdFlat,
                });
            } else if (createdFlat && flat?._id) {
                const opsDb = getOperationsConnection();
                await opsDb.model("Flat").deleteOne({ _id: flat._id }).catch(() => { });
            }
            throw error;
        }
    }

    /**
     * Undo a failed invite so the API error does not leave a partial resident
     * (user, mapping, token, and a newly created empty flat).
     */
    async rollbackResidentInvite(societyId, { userId, flatId, createdFlat }) {
        const masterDb = getMasterConnection();
        const opsDb = getOperationsConnection();

        const User = opsDb.model("User");
        const Resident = opsDb.model("Resident");
        const Flat = opsDb.model("Flat");
        const InviteToken = masterDb.model("InviteToken");
        const UserSocietyMapping = masterDb.model("UserSocietyMapping");

        await Resident.deleteOne({ userId, societyId }).catch(() => { });
        await User.deleteOne({ _id: userId }).catch(() => { });
        await UserSocietyMapping.deleteMany({ userId, societyId }).catch(() => { });
        await InviteToken.deleteMany({ adminId: userId, purpose: "resident" }).catch(() => { });

        if (flatId) {
            if (createdFlat) {
                const remaining = await Resident.countDocuments({ flatId }).catch(() => 1);
                if (remaining === 0) {
                    await Flat.deleteOne({ _id: flatId }).catch(() => {});
                }
            } else {
                await this.syncFlatOccupancy(societyId, flatId, { clearOwnerOnVacant: true }).catch(() => {});
            }
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
        const Block = opsDb.model("Block");

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
        const [flats, blockDoc] = await Promise.all([
            Flat.find({ _id: { $in: flatIds } }).lean(),
            Block.findOne({ societyId }).lean(),
        ]);
        const flatMap = Object.fromEntries(flats.map((f) => [f._id.toString(), f]));
        const wingMap = Object.fromEntries(
            (blockDoc?.wings || []).map((w) => [w._id.toString(), w])
        );

        const residentMap = Object.fromEntries(residents.map((r) => [r.userId.toString(), r]));

        const rows = users.map((user) => {
            const resident = residentMap[user._id.toString()];
            const flat = resident ? flatMap[resident.flatId?.toString()] : null;
            const wing = flat?.blockId ? wingMap[flat.blockId.toString()] : null;
            return {
                _id: user._id,
                name: user.name,
                email: user.email,
                mobile: user.mobile,
                role: user.role,
                status: user.status,
                isActive: user.isActive,
                wingName: wing?.name || null,
                wingCode: wing?.code || null,
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
