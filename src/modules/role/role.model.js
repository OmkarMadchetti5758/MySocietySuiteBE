"use strict";

const mongoose = require("mongoose");

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
        },
        isSystemRole: {
            type: Boolean,
            default: true,
        },
        isEditable: {
            type: Boolean,
            default: true,
        },
        permissions: {
            type: Map,
            of: rolePermissionEntrySchema,
            default: {},
        },
        updatedAt: {
            type: Date,
            default: Date.now,
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
        },
    },
    { timestamps: false } // We manage updatedAt manually to track meaningful edits only
);

roleSchema.index({ societyId: 1, roleKey: 1 }, { unique: true });

roleSchema.index({ societyId: 1 });

module.exports = roleSchema;
