"use strict";

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
