"use strict";

const mongoose = require("mongoose");
const env = require("./env");

/**
 * Connection cache — Maps databaseName → mongoose.Connection
 * Prevents creating duplicate connections for the same tenant.
 */
const connectionCache = new Map();

/**
 * Returns a cached or newly created Mongoose connection for the given tenant database.
 *
 * @param {string} databaseName - The tenant's MongoDB database name (e.g. "society_green_valley")
 * @returns {Promise<mongoose.Connection>}
 */
const getTenantConnection = async (databaseName) => {
    if (!databaseName) {
        throw new Error("databaseName is required to get a tenant connection.");
    }

    // ✅ Reuse existing connection — never reconnect
    if (connectionCache.has(databaseName)) {
        console.log(`♻️  Reusing existing connection for: ${databaseName}`);
        return connectionCache.get(databaseName);
    }

    try {
        const connection = await mongoose.createConnection(env.MONGODB_URI, {
            dbName: databaseName,
        }).asPromise();

        console.log(`🔌 New tenant DB connected: ${databaseName}`);

        // Cache the connection for future requests
        connectionCache.set(databaseName, connection);

        // Clean up cache if connection drops
        connection.on("disconnected", () => {
            console.warn(`⚠️  Tenant DB disconnected: ${databaseName}. Removing from cache.`);
            connectionCache.delete(databaseName);
        });

        connection.on("error", (err) => {
            console.error(`❌ Tenant DB error [${databaseName}]: ${err.message}`);
            connectionCache.delete(databaseName);
        });

        return connection;
    } catch (error) {
        throw new Error(`Failed to connect to tenant DB [${databaseName}]: ${error.message}`);
    }
};

/**
 * Returns all active cached connections (useful for health checks / admin).
 * @returns {string[]} Array of active database names
 */
const getActiveTenantConnections = () => {
    return Array.from(connectionCache.keys());
};

/**
 * Gracefully close all tenant connections (useful on process shutdown).
 */
const closeAllTenantConnections = async () => {
    const names = Array.from(connectionCache.keys());
    await Promise.all(
        names.map(async (name) => {
            const conn = connectionCache.get(name);
            await conn.close();
            connectionCache.delete(name);
            console.log(`🔒 Closed tenant connection: ${name}`);
        })
    );
};

module.exports = {
    getTenantConnection,
    getActiveTenantConnections,
    closeAllTenantConnections,
};
