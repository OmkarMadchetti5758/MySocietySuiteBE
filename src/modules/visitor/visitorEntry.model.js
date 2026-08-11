"use strict";

const mongoose = require("mongoose");
const { VISITOR_STATUS } = require("../../common/constants");

/**
 * VisitorEntry — gate-level visitor log.
 * Lives in mysociety_operations.visitorentries
 */
const visitorEntrySchema = new mongoose.Schema(
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
        visitorName: {
            type: String,
            required: [true, "Visitor name is required"],
            trim: true,
        },
        visitorMobile: {
            type: String,
            trim: true,
        },
        purposeOfVisit: {
            type: String,
            trim: true,
        },
        vehicleNumber: {
            type: String,
            trim: true,
            uppercase: true,
        },
        status: {
            type: String,
            enum: Object.values(VISITOR_STATUS),
            default: VISITOR_STATUS.PENDING,
        },
        entryTime: {
            type: Date,
            default: Date.now,
        },
        exitTime: {
            type: Date,
        },
        approvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        guardId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        photo: {
            type: String, // URL/path to visitor photo
        },
    },
    { timestamps: true }
);

// Latest entries for a flat (most common query pattern)
visitorEntrySchema.index({ societyId: 1, flatId: 1, entryTime: -1 });
// Gate log sorted by time
visitorEntrySchema.index({ societyId: 1, entryTime: -1 });

module.exports = visitorEntrySchema;
