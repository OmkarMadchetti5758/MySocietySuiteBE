"use strict";

const mongoose = require("mongoose");
const { PARKING_TYPE, PARKING_STATUS } = require("../../common/constants");

/**
 * ParkingSlot — physical parking bays within a society.
 * Lives in mysociety_operations.parkingslots
 *
 * Optimistic concurrency: `version` field incremented on each update.
 * Callers should include { version } in update filter to detect stale writes.
 */
const parkingSlotSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        slotNumber: {
            type: String,
            required: [true, "Slot number is required"],
            trim: true,
            uppercase: true,
        },
        type: {
            type: String,
            enum: Object.values(PARKING_TYPE),
            required: [true, "Parking type is required"],
        },
        status: {
            type: String,
            enum: Object.values(PARKING_STATUS),
            default: PARKING_STATUS.AVAILABLE,
        },
        floor: {
            type: String,
            trim: true,
        },
        wing: {
            type: String,
            trim: true,
        },
        location: {
            type: String,
            trim: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        version: {
            type: Number,
            default: 0,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
    },
    { timestamps: true }
);

// Society-scoped unique slot numbers
parkingSlotSchema.index({ societyId: 1, slotNumber: 1 }, { unique: true });

// Query support indexes
parkingSlotSchema.index({ societyId: 1, status: 1 });
parkingSlotSchema.index({ societyId: 1, type: 1, status: 1 });
parkingSlotSchema.index({ societyId: 1, wing: 1, status: 1 });

module.exports = parkingSlotSchema;
