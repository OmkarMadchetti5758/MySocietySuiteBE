"use strict";

const mongoose = require("mongoose");
const { PARKING_TYPE, PARKING_STATUS } = require("../../common/constants");

/**
 * ParkingSlot — physical parking bays within a society.
 * Lives in mysociety_operations.parkingslots
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
        allocatedTo: {
            flatId: { type: mongoose.Schema.Types.ObjectId, ref: "Flat" },
            vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle" },
        },
        floor: {
            type: String,
            trim: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
);

parkingSlotSchema.index({ societyId: 1, slotNumber: 1 }, { unique: true });

module.exports = parkingSlotSchema;
