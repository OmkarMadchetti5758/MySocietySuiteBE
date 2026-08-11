"use strict";

const mongoose = require("mongoose");
const env = require("./env");

let masterConnection = null;

/**
 * Connects to the Master Database.
 * Stores the connection instance for reuse.
 * Should be called once at server startup.
 */
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
        // UserSocietyMapping is also registered on master for login-identifier → societyId lookup
        masterConnection.model("UserSocietyMapping", require("../modules/userSocietyMapping/userSocietyMapping.model"));

        console.log(`✅ Master DB connected: ${masterConnection.name}`);
        return masterConnection;
    } catch (error) {
        console.error(`❌ Master DB connection error: ${error.message}`);
        process.exit(1);
    }
};

/**
 * Returns the active master DB connection.
 * Must be called after connectMasterDB() has resolved.
 */
const getMasterConnection = () => {
    if (!masterConnection) {
        throw new Error("Master DB is not connected. Call connectMasterDB() first.");
    }
    return masterConnection;
};

module.exports = { connectMasterDB, getMasterConnection };
