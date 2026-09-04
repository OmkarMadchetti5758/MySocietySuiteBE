"use strict";

const mongoose = require("mongoose");
const { FESTIVAL_STATUS } = require("../../common/constants");

/**
 * Festival — represents a community event/festival within a society.
 * Lives in mysociety_operations.festivals
 */
const festivalSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        title: {
            type: String,
            required: [true, "Title is required"],
            trim: true,
        },
        description: {
            type: String,
            trim: true,
        },
        date: {
            type: Date,
            required: [true, "Date is required"],
        },
        startTime: {
            type: String, // Stored as "HH:mm" (24-hour format)
            required: [true, "Start time is required"],
        },
        endTime: {
            type: String, // Stored as "HH:mm" (24-hour format)
            required: [true, "End time is required"],
        },
        venue: {
            type: String,
            required: [true, "Venue is required"],
            trim: true,
        },
        image: {
            type: String,
            trim: true,
        },
        status: {
            type: String,
            enum: Object.values(FESTIVAL_STATUS),
            default: FESTIVAL_STATUS.DRAFT,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
    },
    { timestamps: true }
);

festivalSchema.index({ societyId: 1, status: 1, date: 1 });
festivalSchema.index({ societyId: 1, venue: 1, date: 1 });
festivalSchema.index({ societyId: 1, date: 1, startTime: 1 });

module.exports = festivalSchema;
