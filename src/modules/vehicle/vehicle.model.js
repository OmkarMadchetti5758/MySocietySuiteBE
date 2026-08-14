"use strict";

const mongoose = require("mongoose");
const { VEHICLE_TYPE } = require("../../common/constants");

/**
 * Vehicle — resident-owned vehicle registered with the society.
 * Lives in mysociety_operations.vehicles
 */
const vehicleSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        residentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Resident",
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "userId is required"],
        },
        flatId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Flat",
        },
        regNumber: {
            type: String,
            required: [true, "Vehicle registration number is required"],
            trim: true,
            uppercase: true,
        },
        type: {
            type: String,
            enum: Object.values(VEHICLE_TYPE),
            required: [true, "Vehicle type is required"],
        },
        make: {
            type: String,
            trim: true,
        },
        model: {
            type: String,
            trim: true,
        },
        color: {
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

// Unique registration number per society
vehicleSchema.index({ societyId: 1, regNumber: 1 }, { unique: true });

module.exports = vehicleSchema;
