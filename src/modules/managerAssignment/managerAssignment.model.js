"use strict";

const mongoose = require("mongoose");

/**
 * ManagerAssignment — Operational DB
 *
 * Tracks who holds a department-head role in a society, with full
 * assignment metadata (department, joining date, status, audit fields).
 *
 * Separate from UserSocietyMapping (master DB auth-lookup table):
 *   - UserSocietyMapping: used at login-time for identity resolution + roleKeys
 *   - ManagerAssignment: used at admin-time for rich display + lifecycle tracking
 *
 * Both records are created/updated together in the service layer.
 */
const managerAssignmentSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
            index: true,
        },

        // ── Role ─────────────────────────────────────────────────────────────
        roleKey: {
            type: String,
            required: [true, "roleKey is required"],
            trim: true,
            lowercase: true,
            // e.g. "accountant" | "guard_manager" | "facility_manager" | "vendor_manager"
        },
        roleName: {
            type: String,
            required: [true, "roleName is required"],
            trim: true,
        },
        department: {
            type: String,
            required: [true, "department is required"],
            trim: true,
            // e.g. "Finance" | "Security" | "Facility" | "Procurement"
        },

        // ── Person ───────────────────────────────────────────────────────────
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            // References User in the ops-DB. Null until invite is accepted (Path B).
            // Set immediately for Path A (existing resident).
            default: null,
        },
        // Snapshot fields — denormalized for fast display (avoid join on every list)
        managerName: {
            type: String,
            trim: true,
        },
        managerEmail: {
            type: String,
            lowercase: true,
            trim: true,
        },
        managerPhone: {
            type: String,
            trim: true,
        },

        // ── Assignment Metadata ───────────────────────────────────────────────
        joiningDate: {
            type: Date,
            required: [true, "joiningDate is required"],
        },
        status: {
            type: String,
            enum: ["active", "inactive", "invite_pending", "invite_expired"],
            default: "invite_pending",
        },
        isResidentPromoted: {
            type: Boolean,
            default: false,
            // true = Path A (existing resident); false = Path B (new user)
        },

        // ── Audit ─────────────────────────────────────────────────────────────
        assignedBy: {
            type: mongoose.Schema.Types.ObjectId,
            // References the Society Admin (User) who created this assignment
        },
        invitedAt: {
            type: Date,
            default: null,
        },
        activatedAt: {
            type: Date,
            default: null,
            // Set when invite is accepted and password is created (Path B),
            // or immediately on assignment (Path A).
        },
        deactivatedAt: {
            type: Date,
            default: null,
        },
        deactivatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
        },

        // ── OTP State (Path B only) ────────────────────────────────────────────
        // Tracks partial completion so user can resume after OTP without restarting
        emailOtpVerified: {
            type: Boolean,
            default: false,
        },
        phoneOtpVerified: {
            type: Boolean,
            default: false,
        },
    },
    { timestamps: true }
);

// Fast lookup: all managers for a society
managerAssignmentSchema.index({ societyId: 1, status: 1 });
// Fast lookup: current holder of a specific role in a society
managerAssignmentSchema.index({ societyId: 1, roleKey: 1, status: 1 });
// Lookup by userId (e.g., deactivating when a resident moves out)
managerAssignmentSchema.index({ userId: 1, societyId: 1 });

module.exports = managerAssignmentSchema;
