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
        status: {
            type: String,
            enum: ["ACTIVE", "INACTIVE"],
            default: "ACTIVE",
        },
        requiresApproval: {
            type: Boolean,
            default: false,
        },
        advanceBookingLimit: {
            type: Number, // in days
            default: 30,
            min: 0,
        },
        maxBookingDuration: {
            type: Number, // in minutes
            default: 180, // e.g. 3 hours
            min: 1,
        },
        cancellationWindow: {
            type: Number, // in hours before start time
            default: 24,
            min: 0,
        },
        bookingFee: {
            type: Number,
            default: 0,
        },
        images: [String],
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
    },
    { timestamps: true }
);

amenitySchema.index({ societyId: 1 });
amenitySchema.index({ societyId: 1, name: 1 }, { unique: true });

module.exports = amenitySchema;
