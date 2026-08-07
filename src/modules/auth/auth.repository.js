"use strict";

const { getMasterConnection } = require("../../config/masterDb");
const { getTenantConnection } = require("../../config/tenantDb");
const userSchema = require("../user/user.model");

class AuthRepository {
    /**
     * Finds a society in the master DB by user's email or mobile.
     * Note: In a real-world scenario with multiple tenants, you might need a
     * 'UserTenantMapping' collection in the Master DB to look up which society a user belongs to.
     * For this implementation, we assume the user provides society context or we query the master
     * DB if we store emails there, OR we assume a single society per email/mobile mapping in master.
     *
     * Given the requirements, we'll simulate the lookup in the Master DB mapping table.
     * Assuming a `UserSocietyMapping` exists, but for simplicity, we'll check if the login
     * request contains the society identifier or if it's the Admin logging in.
     *
     * Let's refine the approach: we need to find the user's DB.
     * We will use a `UserSocietyMapping` model in master DB. Let's define it inline for the repository.
     */
    async getDatabaseNameForUser(identifier) {
        const masterDb = getMasterConnection();
        // Dynamic schema definition for mapping just for this example
        // In production, this would be a separate model file in master DB models.
        if (!masterDb.models.UserSocietyMapping) {
            const mappingSchema = new masterDb.base.Schema({
                identifier: String, // email or mobile
                databaseName: String,
            });
            masterDb.model("UserSocietyMapping", mappingSchema);
        }
        
        const Mapping = masterDb.model("UserSocietyMapping");
        const mapping = await Mapping.findOne({ identifier });
        
        return mapping ? mapping.databaseName : null;
    }
    
    /**
     * Alternative: If the frontend sends the `databaseName` or `societyId` directly during login.
     * This is common in multi-tenant SaaS (e.g. login.mysociety.com or dropdown selection).
     */
    async getSocietyByDatabaseName(databaseName) {
        const masterDb = getMasterConnection();
        const Society = masterDb.model("Society");
        return Society.findOne({ databaseName, status: "active" });
    }

    /**
     * Finds a user in the specific tenant DB.
     */
    async findUserByIdentifier(tenantDb, identifier) {
        if (!tenantDb.models.User) {
            tenantDb.model("User", userSchema);
        }
        const User = tenantDb.model("User");
        return User.findOne({
            $or: [{ email: identifier }, { mobile: identifier }]
        }).select("+password +refreshToken");
    }

    async findUserById(tenantDb, userId) {
        if (!tenantDb.models.User) {
            tenantDb.model("User", userSchema);
        }
        const User = tenantDb.model("User");
        return User.findById(userId);
    }

    async saveRefreshToken(tenantDb, userId, refreshToken) {
        if (!tenantDb.models.User) {
            tenantDb.model("User", userSchema);
        }
        const User = tenantDb.model("User");
        return User.findByIdAndUpdate(userId, { refreshToken, lastLogin: new Date() });
    }
    
    async clearRefreshToken(tenantDb, userId) {
        if (!tenantDb.models.User) {
            tenantDb.model("User", userSchema);
        }
        const User = tenantDb.model("User");
        return User.findByIdAndUpdate(userId, { $unset: { refreshToken: 1 } });
    }
}

module.exports = new AuthRepository();
