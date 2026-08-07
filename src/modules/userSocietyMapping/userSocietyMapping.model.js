"use strict";

const mongoose = require("mongoose");

const userSocietyMappingSchema = new mongoose.Schema(
    {
        identifier: {
            type: String, // email or mobile
            required: true,
            index: true,
            lowercase: true,
            trim: true,
        },
        databaseName: {
            type: String,
            required: true,
        }
    },
    { timestamps: true }
);

// Create compound index to ensure one identifier maps to one database (assuming 1-to-1 for simplicity, though multi-tenant can support 1-to-N)
userSocietyMappingSchema.index({ identifier: 1, databaseName: 1 }, { unique: true });

module.exports = userSocietyMappingSchema;
