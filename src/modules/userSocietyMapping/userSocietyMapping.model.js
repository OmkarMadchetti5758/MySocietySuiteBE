"use strict";

const mongoose = require("mongoose");

const userSocietyMappingSchema = new mongoose.Schema(
    {
        identifier: {
            type: String, // email or mobile number
            required: [true, "Identifier (email or mobile) is required"],
            index: true,
            lowercase: true,
            trim: true,
        },
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
        },

        roleKeys: {
            type: [String],
            default: [],
        },
        flatId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
        },
        status: {
            type: String,
            enum: ["active", "deactivated"],
            default: "active",
        },
        joinedAt: {
            type: Date,
            default: Date.now,
        },
        deactivatedAt: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

// Compound unique: one identifier maps to one society (prevents duplicate mappings)
userSocietyMappingSchema.index({ identifier: 1, societyId: 1 }, { unique: true });
// Fast lookup by userId + societyId (runtime permission resolution path)
userSocietyMappingSchema.index({ userId: 1, societyId: 1 });
// Filter by society + status (e.g. list all active users for a society)
userSocietyMappingSchema.index({ societyId: 1, status: 1 });

module.exports = userSocietyMappingSchema;
