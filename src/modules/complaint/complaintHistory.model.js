"use strict";

const mongoose = require("mongoose");

/**
 * ComplaintHistory — full audit trail for every ticket lifecycle event.
 * Lives in mysociety_operations.complainthistories
 *
 * One record per action. Immutable after creation.
 * Residents and vendors cannot delete records.
 */
const complaintHistorySchema = new mongoose.Schema(
    {
        // ── Scoping ───────────────────────────────────────────────────────────
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        complaintId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Complaint",
            required: [true, "complaintId is required"],
        },

        // ── Action ────────────────────────────────────────────────────────────
        action: {
            type: String,
            required: [true, "action is required"],
            enum: [
                "CREATED",
                "ASSIGNED",
                "REASSIGNED",
                "STATUS_CHANGED",
                "RESOLUTION_SUBMITTED",
                "RESOLUTION_CONFIRMED",
                "REOPENED",
                "ESCALATED",
                "CLOSED",
            ],
        },

        // ── Who performed the action ──────────────────────────────────────────
        performedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "performedBy is required"],
        },
        performedByRole: {
            type: String,
            required: [true, "performedByRole is required"],
        },

        // ── What changed ──────────────────────────────────────────────────────
        previousValue: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },
        newValue: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },

        // ── Extra context ─────────────────────────────────────────────────────
        remarks: {
            type: String,
            trim: true,
            default: null,
        },
    },
    {
        timestamps: true,
        // Prevent accidental mutation of history records
    }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
// Fetch full history for a specific complaint in chronological order
complaintHistorySchema.index({ societyId: 1, complaintId: 1, createdAt: 1 });

// Find all actions performed by a specific user within a society
complaintHistorySchema.index({ societyId: 1, performedBy: 1, createdAt: -1 });

module.exports = complaintHistorySchema;
