"use strict";

const mongoose = require("mongoose");

const rolePermissionAuditSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        roleKey: {
            type: String,
            required: true,
            trim: true,
        },
        changedBy: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            // userId of the Committee Admin who made the change
        },
        changedByName: {
            type: String,
            default: "",
            // Snapshot of the admin's name at time of change (denormalized for display)
        },
        changedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        diff: {
            before: {
                type: mongoose.Schema.Types.Mixed,
                default: {},
                // Snapshot of permissions map before the change
            },
            after: {
                type: mongoose.Schema.Types.Mixed,
                default: {},
                // Snapshot of permissions map after the change
            },
        },
        action: {
            type: String,
            enum: ["update", "reset"],
            default: "update",
            // "update" = PATCH; "reset" = reset to GLOBAL
        },
    },
    {
        timestamps: false,    // changedAt is our explicit timestamp
        collection: "rolepermissionaudits",
    }
);

// Index for compliance queries: all changes for a society sorted by time
rolePermissionAuditSchema.index({ societyId: 1, changedAt: -1 });

module.exports = rolePermissionAuditSchema;
