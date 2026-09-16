"use strict";

const mongoose = require("mongoose");

/**
 * GuardGateAssignment — Maps a Guard to a Gate for a specific shift.
 */
const guardGateAssignmentSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        guardId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "guardId is required"],
        },
        gateId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Gate",
            required: [true, "gateId is required"],
        },
        startTime: {
            type: Date,
            required: [true, "Start time is required"],
        },
        endTime: {
            type: Date,
            required: [true, "End time is required"],
        },
        handoverNote: {
            type: String,
            trim: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
    },
    { timestamps: true }
);

// To find current active shift for a guard
guardGateAssignmentSchema.index({ societyId: 1, guardId: 1, isActive: 1 });
// To find all guards at a specific gate
guardGateAssignmentSchema.index({ societyId: 1, gateId: 1, isActive: 1 });

module.exports = guardGateAssignmentSchema;
