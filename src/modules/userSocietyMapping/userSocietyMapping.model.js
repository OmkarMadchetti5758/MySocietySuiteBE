"use strict";

const mongoose = require("mongoose");

/**
 * UserSocietyMapping — Master DB
 *
 * Maps a login identifier (email or mobile) to the society the user belongs to.
 * This is the global login-lookup table: given an identifier, find which society
 * to scope the authentication query against in mysociety_operations.users.
 *
 * Replaces the old `databaseName` field (which pointed to a per-tenant MongoDB DB).
 * Now points to `societyId` (an ObjectId reference to mysociety_master.societies).
 *
 * A single person can belong to multiple societies → multiple rows, one per (identifier, societyId) pair.
 */
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
            // References the user document in mysociety_operations.users
            // Not a cross-DB ref, stored for informational reverse-lookup only
        },
    },
    { timestamps: true }
);

// Compound unique: one identifier maps to one society (prevents duplicate mappings)
userSocietyMappingSchema.index({ identifier: 1, societyId: 1 }, { unique: true });
// Fast forward lookup by societyId (e.g. list all users for a society)
userSocietyMappingSchema.index({ userId: 1, societyId: 1 });

module.exports = userSocietyMappingSchema;
