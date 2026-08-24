"use strict";

const mongoose = require("mongoose");

/**
 * Attendance — daily attendance record per staff member.
 * Lives in mysociety_operations.attendances
 *
 * Extra staff-attendance fields (no separate collection needed):
 *   - notes        : optional remarks by the facility manager
 *   - checkInTime  : optional time staff checked in (HH:MM string, e.g. "09:05")
 *   - checkOutTime : optional time staff checked out
 *   - markedAt     : timestamp when the attendance was last marked/updated
 */
const attendanceSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        staff: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Staff",
            required: true,
        },
        date: {
            type: Date,
            required: true,
        },
        status: {
            type: String,
            enum: ["present", "absent", "on-leave"],
            required: true,
        },
        markedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        // ── Staff-attendance specific fields ──────────────────────────────
        notes: {
            type: String,
            trim: true,
            maxlength: 500,
        },
        checkInTime: {
            type: String,   // "HH:MM" format, e.g. "09:05"
            trim: true,
        },
        checkOutTime: {
            type: String,   // "HH:MM" format, e.g. "17:30"
            trim: true,
        },
        markedAt: {
            type: Date,     // Timestamp when attendance was last marked
            default: Date.now,
        },
    },
    { timestamps: true }
);

// One record per staff per day per society
attendanceSchema.index({ societyId: 1, staff: 1, date: 1 }, { unique: true });
attendanceSchema.index({ societyId: 1, date: 1 });

module.exports = attendanceSchema;
