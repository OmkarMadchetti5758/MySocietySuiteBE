"use strict";

const mongoose = require("mongoose");

/**
 * UserSocietyMapping — Master DB
 *
 * Maps a login identifier (email or mobile) to the society the user belongs to
 * AND captures which RBAC roles that user holds within that society.
 *
 * This is the global login-lookup table AND the role-assignment store.
 * Given an identifier + societyId, we get:
 *   - The user's userId (for ops-DB queries)
 *   - Their roleKeys[] (for permission resolution)
 *   - Their flatId (for resident-scoped queries)
 *   - Their status (active / deactivated)
 *
 * A single person can belong to multiple societies → multiple rows, one per (identifier, societyId) pair.
 * A user with two roles in the same society (e.g. Owner + Committee Member) has one row with multiple roleKeys.
 *
 * Runtime Permission Resolution (BRD §2):
 *   1. Fetch this doc by (userId, societyId) → get roleKeys[]
 *   2. Fetch roles docs for (societyId, roleKeys); fall back to GLOBAL if no society override
 *   3. Union permissions across all roleKeys (highest access wins)
 *   4. Cache merged set in JWT claims; invalidate via Society.permissionsVersion
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
        },

        // ── RBAC Fields ────────────────────────────────────────────────────────
        roleKeys: {
            type: [String],
            default: [],
            // Array of BRD role keys this user holds in this society.
            // Multiple entries support dual-role users (e.g. Owner + Committee Member).
            // e.g. ["resident_owner"] or ["resident_owner", "committee_admin"]
        },
        flatId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
            // Flat assignment for resident roles.
            // null for non-resident roles (accountant, security_guard, vendor, etc.)
        },
        status: {
            type: String,
            enum: ["active", "deactivated"],
            default: "active",
            // Deactivated users are rejected at auth-middleware level, not just hidden in UI.
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
