"use strict";

const mongoose = require("mongoose");

/**
 * AmenitySlot — configurable time slot for an amenity.
 */
const amenitySlotSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        amenityId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Amenity",
            required: [true, "amenityId is required"],
        },
        dayOfWeek: {
            type: String,
            enum: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "All"],
            required: true,
        },
        startTime: {
            type: String, // e.g. "10:00"
            required: true,
        },
        endTime: {
            type: String, // e.g. "13:00"
            required: true,
        },
        status: {
            type: String,
            enum: ["ACTIVE", "INACTIVE"],
            default: "ACTIVE",
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
    },
    { timestamps: true }
);

amenitySlotSchema.index({ societyId: 1, amenityId: 1 });

module.exports = amenitySlotSchema;
