"use strict";

const mongoose = require("mongoose");
const env = require("./env");

let masterConnection = null;

const connectMasterDB = async () => {
    if (masterConnection) {
        return masterConnection;
    }

    try {
        masterConnection = await mongoose.createConnection(env.MONGODB_URI, {
            dbName: env.MASTER_DB_NAME,
        }).asPromise();

        // Register Master-only (control plane) Models
        masterConnection.model("Society", require("../modules/society/society.model"));
        masterConnection.model("SubscriptionPlan", require("../modules/subscriptionPlan/subscriptionPlan.model"));
        masterConnection.model("Subscription", require("../modules/subscription/subscription.model"));
        masterConnection.model("SuperAdmin", require("../modules/superAdmin/superAdmin.model"));
        masterConnection.model("GlobalSetting", require("../modules/globalSetting/globalSetting.model"));
        masterConnection.model("Role", require("../modules/role/role.model"));
        masterConnection.model("Permission", require("../modules/permission/permission.model"));
        masterConnection.model("InviteToken", require("../modules/auth/inviteToken.model"));
        masterConnection.model("Otp", require("../modules/otp/otp.model"));
        // UserSocietyMapping is also registered on master for login-identifier → societyId lookup
        masterConnection.model("UserSocietyMapping", require("../modules/userSocietyMapping/userSocietyMapping.model"));

        await syncUserSocietyMappingIndexes(masterConnection);

        console.log(`✅ Master DB connected: ${masterConnection.name}`);
        return masterConnection;
    } catch (error) {
        console.error(`❌ Master DB connection error: ${error.message}`);
        process.exit(1);
    }
};

const getMasterConnection = () => {
    if (!masterConnection) {
        throw new Error("Master DB is not connected. Call connectMasterDB() first.");
    }
    return masterConnection;
};

const syncUserSocietyMappingIndexes = async (connection) => {
    try {
        const collection = connection.collection("usersocietymappings");
        const indexes = await collection.indexes();

        for (const idx of indexes) {
            if (idx.key?.databaseName !== undefined) {
                await collection.dropIndex(idx.name);
                console.log(`🗑️  Dropped legacy UserSocietyMapping index: ${idx.name}`);
            }
        }

        const Mapping = connection.model("UserSocietyMapping");
        await Mapping.syncIndexes();
    } catch (error) {
        console.warn(`⚠️  UserSocietyMapping index sync: ${error.message}`);
    }
};

module.exports = { connectMasterDB, getMasterConnection };
