"use strict";

const mongoose = require("mongoose");

const wingSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, "Wing name is required"],
            trim: true,
        },
        code: {
            type: String,
            required: [true, "Wing code is required"],
            trim: true,
        },
        totalFloors: {
            type: Number,
            required: [true, "Number of floors is required"],
            min: 1,
        },
        unitsPerFloor: {
            type: Number,
            min: 1,
        },
        totalFlats: {
            type: Number,
            min: 0,
        },
        status: {
            type: String,
            enum: ["Active", "Inactive", "Under Maintenance"],
            default: "Active",
        },
        assignedStaff: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Staff",
        },
        propertyType: {
            type: String,
            trim: true,
        },
        configuration: {
            type: String,
            trim: true,
        },
        unitCount: {
            type: Number,
            default: 0,
        },
        carpetArea: {
            type: Number,
        },
        builtUpArea: {
            type: Number,
        },
        parking4W: {
            type: Number,
            default: 0,
        },
    },
    { _id: true }
);

const commercialUnitSchema = new mongoose.Schema(
    {
        block: { type: String, trim: true },
        commercialType: { type: String, trim: true }, // "Shop", "Office", "Showroom"
        unitSize: { type: Number },
        unitCount: { type: Number, default: 0 },
        parking: { type: Number, default: 0 },
    },
    { _id: true }
);

/**
 * Block - one document per society, containing all its wings.
 * Lives in mysociety_operations.blocks
 */
const blockSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
            unique: true, // One record per society (creates the unique index)
        },
        wings: [wingSchema],
        commercialUnits: [commercialUnitSchema],
    },
    { timestamps: true }
);

module.exports = blockSchema;
