"use strict";

const mongoose = require("mongoose");

const noticeSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "createdBy is required"],
        },
        type: {
            type: String,
            enum: ["general", "circular", "emergency", "maintenance", "event"],
            default: "general",
            required: [true, "Notice type is required"],
        },
        title: {
            type: String,
            required: [true, "Title is required"],
            trim: true,
        },
        description: {
            type: String,
            required: [true, "Description is required"],
            trim: true,
        },
        attachmentUrl: {
            type: String,
            trim: true,
            default: null,
        },
        targetType: {
            type: String,
            enum: ["ALL", "BLOCK"],
            required: [true, "targetType is required"],
            default: "ALL",
        },
        targetBlockId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Block",
            required: function () {
                return this.targetType === "BLOCK";
            },
        },
        isPinned: {
            type: Boolean,
            default: false,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
);

// Indexes for faster querying
noticeSchema.index({ societyId: 1, createdAt: -1 });
noticeSchema.index({ societyId: 1, targetType: 1 });
noticeSchema.index({ societyId: 1, targetBlockId: 1 });

module.exports = noticeSchema;
