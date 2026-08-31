"use strict";

const mongoose = require("mongoose");

/**
 * VendorAssignmentHistory
 * Tracks the history of vendor assignments to tasks (Complaints/Work Orders).
 * Enables querying past assignments and vendor performance reporting.
 */
const vendorAssignmentHistorySchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        taskId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Complaint",
            required: [true, "taskId is required"],
        },
        vendorId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Vendor",
            required: [true, "vendorId is required"],
        },
        assignedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "assignedBy is required"],
        },
        assignedAt: {
            type: Date,
            required: [true, "assignedAt is required"],
            default: Date.now,
        },
        unassignedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        unassignedAt: {
            type: Date,
        },
        reason: {
            type: String,
            trim: true,
        },
    },
    { timestamps: true }
);

vendorAssignmentHistorySchema.index({ societyId: 1, vendorId: 1, taskId: 1 });
vendorAssignmentHistorySchema.index({ societyId: 1, taskId: 1 });
vendorAssignmentHistorySchema.index({ societyId: 1, vendorId: 1, assignedAt: -1 });

module.exports = vendorAssignmentHistorySchema;
