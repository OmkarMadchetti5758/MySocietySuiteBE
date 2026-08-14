"use strict";

const mongoose = require("mongoose");

/**
 * Permission Catalog — Master DB
 *
 * Global list of all 13 platform modules and their valid access-level vocabulary.
 * Seeded once on platform init; rarely changes.
 * Powers the toggle UI labels/order. Not society-specific.
 *
 * hardBlockedFor: roles that MUST NOT see this module toggle at all
 * (the module is completely invisible to them in the UI and rejected in API).
 */
const permissionSchema = new mongoose.Schema(
    {
        moduleKey: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            // e.g. "billingAccounts", "visitorManagement"
        },
        moduleName: {
            type: String,
            required: true,
            trim: true,
            // e.g. "Billing & Accounts"
        },
        sortOrder: {
            type: Number,
            required: true,
            default: 99,
        },
        validAccessLevels: {
            type: [String],
            default: ["none", "view", "full"],
            // Vocabulary of access levels applicable to this module.
            // e.g. ["none", "view", "full"] or ["none", "view", "view_pay_own", "full"]
        },
        hardBlockedFor: {
            type: [String],
            default: [],
            // roleKeys that are HARD-BLOCKED from this module.
            // These roles will NEVER see this toggle in the UI.
            // The service layer rejects any PATCH that tries to enable this module for them.
        },
        description: {
            type: String,
            default: "",
        },
        isDeprecated: {
            type: Boolean,
            default: false,
            // Soft-delete: deprecated modules are ignored on read.
        },
    },
    { timestamps: true }
);

module.exports = permissionSchema;
