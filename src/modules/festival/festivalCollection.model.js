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
            index: true,
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
        purpose: {
            type: String,
            trim: true,
            required: [true, "Purpose is required"],
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
        suggestedAmount: {
            type: Number,
            default: 0,
            min: 0,
        },
        startDate: {
            type: Date,
            required: [true, "Start date is required"],
        },
        dueDate: {
            type: Date,
            required: [true, "Due date is required"],
        },
        eventDate: {
            type: Date,
            required: [true, "Event date is required"],
        },
        applicableType: {
            type: String,
            enum: ["ALL", "SPECIFIC_BLOCK", "SPECIFIC_FLAT"],
            default: "ALL",
        },
        applicableBlocks: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Block",
            }
        ],
        applicableFlats: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Flat",
            }
        ],
        status: {
            type: String,
            enum: ["DRAFT", "ACTIVE", "CLOSED", "CANCELLED"],
            default: "DRAFT",
            index: true,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
    },
    { timestamps: true }
);

festivalCollectionSchema.index({ societyId: 1, dueDate: 1 });
festivalCollectionSchema.index({ societyId: 1, status: 1 });

module.exports = festivalCollectionSchema;
