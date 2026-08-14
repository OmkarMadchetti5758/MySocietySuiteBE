"use strict";

const mongoose = require("mongoose");

/**
 * Role Templates — Master DB
 *
 * Stores GLOBAL default role templates and per-society overrides.
 *
 * societyId === "GLOBAL"  →  system default template (seeded from BRD)
 * societyId === ObjectId  →  society-specific override (created copy-on-write)
 *
 * Copy-on-write strategy:
 *   - New societies run purely off GLOBAL role docs.
 *   - Only when a Committee Admin saves a change does a society-specific doc get created.
 *   - This keeps storage lean and lets BRD updates propagate automatically to un-customized societies.
 *
 * Compound unique index: { societyId, roleKey } — one doc per role per society.
 */
const rolePermissionEntrySchema = new mongoose.Schema(
    {
        access: {
            type: String,
            required: true,
            // e.g. "none" | "view" | "full" | "view_pay_own" | "manage_assigned"
        },
        enabled: {
            type: Boolean,
            default: true,
        },
    },
    { _id: false }
);

const roleSchema = new mongoose.Schema(
    {
        societyId: {
            type: String,
            required: true,
            // "GLOBAL" for platform defaults; ObjectId string for society overrides
        },
        roleKey: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            // e.g. "admin" | "accountant" | "resident_owner" | "resident_tenant"
            //      | "security_guard" | "facility_manager" | "vendor"
        },
        roleName: {
            type: String,
            required: true,
            trim: true,
            // e.g. "Committee / Society Admin"
        },
        isSystemRole: {
            type: Boolean,
            default: true,
            // true = seeded from BRD; cannot be deleted by society admin
        },
        isEditable: {
            type: Boolean,
            default: true,
            // false = society admin CANNOT modify this role at all
            // (e.g. committee_admin cannot elevate itself)
        },
        permissions: {
            type: Map,
            of: rolePermissionEntrySchema,
            default: {},
            // Map<moduleKey, { access, enabled }>
            // e.g. { "billingAccounts": { access: "full", enabled: true } }
        },
        updatedAt: {
            type: Date,
            default: Date.now,
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
            // ObjectId of the Committee Admin who last edited; null for GLOBAL docs
        },
    },
    { timestamps: false } // We manage updatedAt manually to track meaningful edits only
);

// Compound unique: one role doc per (societyId, roleKey) pair
roleSchema.index({ societyId: 1, roleKey: 1 }, { unique: true });

// Fast lookup by societyId (list all roles for a society)
roleSchema.index({ societyId: 1 });

module.exports = roleSchema;
