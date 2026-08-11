"use strict";

const mongoose = require("mongoose");
const { COMPLAINT_STATUS, COMPLAINT_PRIORITY } = require("../../common/constants");

/**
 * Complaint — helpdesk ticket raised by a resident.
 * Lives in mysociety_operations.complaints
 */
const complaintSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        flatId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Flat",
            required: [true, "flatId is required"],
        },
        raisedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "raisedBy is required"],
        },
        assignedTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        title: {
            type: String,
            required: [true, "Complaint title is required"],
            trim: true,
        },
        description: {
            type: String,
            required: [true, "Description is required"],
            trim: true,
        },
        category: {
            type: String,
            trim: true, // e.g. "Plumbing", "Electrical", "Common Area"
        },
        status: {
            type: String,
            enum: Object.values(COMPLAINT_STATUS),
            default: COMPLAINT_STATUS.OPEN,
        },
        priority: {
            type: String,
            enum: Object.values(COMPLAINT_PRIORITY),
            default: COMPLAINT_PRIORITY.MEDIUM,
        },
        resolvedAt: {
            type: Date,
        },
        remarks: {
            type: String,
            trim: true,
        },
        attachments: [String], // Array of URLs/paths
    },
    { timestamps: true }
);

complaintSchema.index({ societyId: 1, status: 1 });
complaintSchema.index({ societyId: 1, flatId: 1 });
complaintSchema.index({ societyId: 1, raisedBy: 1 });

module.exports = complaintSchema;
