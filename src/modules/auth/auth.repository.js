"use strict";

const { getMasterConnection } = require("../../config/masterDb");
const { getOperationsConnection } = require("../../config/operationsDb");
const { identifierLookupValues, phoneRegexForLookup, isEmail } = require("../../common/loginIdentifier");

class AuthRepository {
    async getMappingsForIdentifier(identifier) {
        const masterDb = getMasterConnection();
        const Mapping = masterDb.model("UserSocietyMapping");
        const variants = identifierLookupValues(identifier);
        if (variants.length === 0) return [];
        return Mapping.find({ identifier: { $in: variants } }).lean();
    }
    async findUsersByLoginIdentifier(identifier) {
        const opsDb = getOperationsConnection();
        const User = opsDb.model("User");
        const variants = identifierLookupValues(identifier);
        if (variants.length === 0) return [];

        const or = [];
        if (isEmail(identifier)) {
            or.push({ email: variants[0] });
        } else {
            or.push({ mobile: { $in: variants } });
            const phoneRe = phoneRegexForLookup(identifier);
            if (phoneRe) or.push({ mobile: phoneRe });
        }

        return User.find({ $or: or }).select("_id societyId email mobile role").lean();
    }

    async getSocietyById(societyId) {
        const masterDb = getMasterConnection();
        const Society = masterDb.model("Society");
        return Society.findOne({ _id: societyId, status: "active" }).lean();
    }

    async findUserByIdentifier(societyId, identifier) {
        const opsDb = getOperationsConnection();
        const User = opsDb.model("User");
        const variants = identifierLookupValues(identifier);
        if (variants.length === 0) return null;

        const or = [
            { email: { $in: variants } },
            { mobile: { $in: variants } },
        ];
        const phoneRe = !isEmail(identifier) ? phoneRegexForLookup(identifier) : null;
        if (phoneRe) or.push({ mobile: phoneRe });

        return User.findOne({
            societyId,
            $or: or,
        }).select("+password +refreshToken");
    }

    async findSuperAdminByEmail(email) {
        const masterDb = getMasterConnection();
        const SuperAdmin = masterDb.model("SuperAdmin");
        return SuperAdmin.findOne({ email: email.toLowerCase().trim() }).select("+password");
    }

    async findSuperAdminById(adminId) {
        const masterDb = getMasterConnection();
        const SuperAdmin = masterDb.model("SuperAdmin");
        return SuperAdmin.findById(adminId);
    }
    async getMappingForUser(societyId, userId) {
        const masterDb = getMasterConnection();
        const Mapping = masterDb.model("UserSocietyMapping");
        return Mapping.findOne({ userId, societyId }).lean();
    }

    async findUserById(societyId, userId) {
        const opsDb = getOperationsConnection();
        const User = opsDb.model("User");
        return User.findOne({ _id: userId, societyId });
    }

    async saveRefreshToken(userId, refreshToken) {
        const opsDb = getOperationsConnection();
        const User = opsDb.model("User");
        return User.findByIdAndUpdate(userId, { refreshToken, lastLogin: new Date() });
    }

    async clearRefreshToken(userId) {
        const opsDb = getOperationsConnection();
        const User = opsDb.model("User");
        return User.findByIdAndUpdate(userId, { $unset: { refreshToken: 1 } });
    }

    async saveSuperAdminRefreshToken(adminId, refreshToken) {
        const masterDb = getMasterConnection();
        const SuperAdmin = masterDb.model("SuperAdmin");
        return SuperAdmin.findByIdAndUpdate(adminId, { refreshToken, lastLogin: new Date() });
    }

    async clearSuperAdminRefreshToken(adminId) {
        const masterDb = getMasterConnection();
        const SuperAdmin = masterDb.model("SuperAdmin");
        return SuperAdmin.findByIdAndUpdate(adminId, { $unset: { refreshToken: 1 } });
    }
}

module.exports = new AuthRepository();
