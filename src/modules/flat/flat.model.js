"use strict";

const mongoose = require("mongoose");
const { FLAT_TYPE, FLAT_STATUS } = require("../../common/constants");

/**
 * Flat — individual apartment/unit within a block.
 * Lives in mysociety_operations.flats
 */
const flatSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        blockId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Block",
            required: [true, "blockId is required"],
        },
        flatNumber: {
            type: String,
            required: [true, "Flat number is required"],
            trim: true,
        },
        floor: {
            type: Number,
            default: 0,
        },
        type: {
            type: String,
        },
        area: {
            type: Number, // in sq ft
        },
        ownershipType: {
            type: String,
            trim: true,
        },
        occupancyStatus: {
            type: String,
            enum: ["Vacant", "Owner Occupied", "Tenant Occupied"],
            default: "Vacant",
        },
        primaryOwner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        activeTenant: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        numberOfResidents: {
            type: Number,
            default: 0,
        },
        parkingSlots: {
            type: Number,
            default: 0,
        },
        possessionDate: {
            type: Date,
        },
        status: {
            type: String,
            enum: Object.values(FLAT_STATUS),
            default: FLAT_STATUS.VACANT,
        },
        ownerName: {
            type: String,
            trim: true,
        },
        ownerContact: {
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

flatSchema.index({ societyId: 1, blockId: 1 });
flatSchema.index({ societyId: 1, flatNumber: 1 }, { unique: true });

module.exports = flatSchema;
