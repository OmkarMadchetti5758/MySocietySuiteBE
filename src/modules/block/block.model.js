"use strict";

const mongoose = require("mongoose");

/**
 * Block — a named wing/tower within a society (e.g. "A Wing", "Tower 1").
 * Lives in mysociety_operations.blocks
 */
const blockSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        name: {
            type: String,
            required: [true, "Block name is required"],
            trim: true,
        },
        description: {
            type: String,
            trim: true,
        },
        totalFloors: {
            type: Number,
            min: 1,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
);

blockSchema.index({ societyId: 1 });
blockSchema.index({ societyId: 1, name: 1 }, { unique: true });

module.exports = blockSchema;
