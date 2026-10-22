"use strict";

const { MODULES } = require("./constants");

/**
 * Authoritative registry of system modules available for plan configuration.
 * Reuses canonical module keys from constants.js.
 */
const MODULE_REGISTRY = Object.freeze([
    { key: MODULES.SOCIETY_FLAT_SETUP, name: "Society & Flats", category: "Core", isActive: true },
    { key: "residents", name: "Residents", category: "Core", isActive: true },
    { key: MODULES.BILLING_ACCOUNTS, name: "Billing & Accounts", category: "Finance", isActive: true },
    { key: MODULES.VISITOR_MANAGEMENT, name: "Visitors", category: "Security", isActive: true },
    { key: MODULES.COMPLAINTS_HELPDESK, name: "Helpdesk", category: "Operations", isActive: true },
    { key: "notices", name: "Notices", category: "Communication", isActive: true },
    { key: "polls", name: "Polls", category: "Communication", isActive: true },
    { key: MODULES.AMENITY_BOOKING, name: "Amenities", category: "Facilities", isActive: true },
    { key: MODULES.PARKING_MANAGEMENT, name: "Parking", category: "Operations", isActive: true },
    { key: MODULES.VENDOR_MANAGEMENT, name: "Vendors", category: "Operations", isActive: true },
    { key: MODULES.STAFF_MANAGEMENT, name: "Staff", category: "Operations", isActive: true },
    { key: MODULES.DOCUMENTS_MANAGER, name: "Documents", category: "Compliance", isActive: true },
    { key: MODULES.REPORTS_DASHBOARD, name: "Reports", category: "Analytics", isActive: true },
    { key: MODULES.AI_ASSISTANT, name: "AI Assistant", category: "Intelligence", isActive: true },
    { key: "festivals", name: "Festivals", category: "Community", isActive: true },
    { key: MODULES.COMMUNITY_EVENTS, name: "Events", category: "Community", isActive: true },
    { key: MODULES.SETTINGS, name: "Settings", category: "Core", isActive: true },
]);

const getAvailableModules = () => {
    return MODULE_REGISTRY.filter((m) => m.isActive);
};

module.exports = {
    MODULE_REGISTRY,
    getAvailableModules,
};
