"use strict";

/**
 * ⛔ DEPRECATED — tenantDb.js
 *
 * The database-per-tenant model has been retired.
 * All operational data now lives in a single shared DB: `mysociety_operations`.
 *
 * Migration completed: 2026-08-11
 *
 * Replace any usage of these functions:
 *
 *   OLD:  const { getTenantConnection } = require("./tenantDb");
 *         const db = await getTenantConnection(databaseName);
 *         const Model = db.model("Foo", fooSchema);
 *
 *   NEW:  const { getOperationsConnection } = require("./operationsDb");
 *         const db = getOperationsConnection();
 *         const Model = db.model("Foo"); // already registered at startup
 *         // Always scope queries with: { societyId: req.user.societyId, ...otherFilters }
 *
 * This file is kept temporarily for rollback reference. It will be removed
 * after the old per-society databases are verified and dropped.
 */

const getTenantConnection = async (databaseName) => {
    throw new Error(
        `[DEPRECATED] getTenantConnection("${databaseName}") called. ` +
        "The per-tenant DB model has been retired. " +
        "Use getOperationsConnection() from config/operationsDb.js instead."
    );
};

const getActiveTenantConnections = () => {
    console.warn("[DEPRECATED] getActiveTenantConnections() — per-tenant DBs retired.");
    return [];
};

const closeAllTenantConnections = async () => {
    console.warn("[DEPRECATED] closeAllTenantConnections() — no-op, per-tenant DBs retired.");
};

module.exports = {
    getTenantConnection,
    getActiveTenantConnections,
    closeAllTenantConnections,
};
