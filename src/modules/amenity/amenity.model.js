"use strict";

const mongoose = require("mongoose");

/**
 * Amenity — a bookable facility within a society (e.g. clubhouse, pool, gym).
 * Lives in mysociety_operations.amenities
 */
const amenitySchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        name: {
            type: String,
            required: [true, "Amenity name is required"],
            trim: true,
        },
        description: {
            type: String,
            trim: true,
        },
        capacity: {
            type: Number,
            min: 1,
        },
        isBookable: {
            type: Boolean,
            default: true,
        },
        availableSlots: [
            {
                day: { type: String }, // e.g. "Monday" or "all"
                startTime: { type: String }, // e.g. "06:00"
                endTime: { type: String },   // e.g. "22:00"
            }
        ],
        chargePerSlot: {
            type: Number,
            default: 0,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        images: [String],
    },
    { timestamps: true }
);

amenitySchema.index({ societyId: 1 });
amenitySchema.index({ societyId: 1, name: 1 }, { unique: true });

module.exports = amenitySchema;
