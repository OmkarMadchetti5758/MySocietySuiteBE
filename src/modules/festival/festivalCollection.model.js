"use strict";

const mongoose = require("mongoose");

/**
 * FestivalCollection — a society-initiated fundraiser for a festival/event.
 * Lives in mysociety_operations.festivalcollections
 */
const festivalCollectionSchema = new mongoose.Schema(
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
        targetAmount: {
            type: Number,
            required: [true, "Target amount is required"],
            min: 0,
        },
        collectedAmount: {
            type: Number,
            default: 0,
            min: 0,
        },
        amountPerFlat: {
            type: Number,
            default: 0,
            min: 0,
        },
        dueDate: {
            type: Date,
            required: [true, "Due date is required"],
        },
        eventDate: {
            type: Date,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
    },
    { timestamps: true }
);

festivalCollectionSchema.index({ societyId: 1, dueDate: 1 });

module.exports = festivalCollectionSchema;
