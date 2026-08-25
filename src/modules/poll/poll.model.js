"use strict";

const mongoose = require("mongoose");
const { POLL_STATUS } = require("../../common/constants");

const pollSchema = new mongoose.Schema(
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
        question: {
            type: String,
            required: [true, "Poll question is required"],
            trim: true,
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
        closingDate: {
            type: Date,
            required: [true, "closingDate is required"],
        },
        options: [
            {
                text: { type: String, required: true },
            }
        ],
        status: {
            type: String,
            enum: Object.values(POLL_STATUS),
            default: POLL_STATUS.ACTIVE,
        }
    },
    { timestamps: true }
);

// Indexes
pollSchema.index({ societyId: 1, createdAt: -1 });
pollSchema.index({ societyId: 1, targetType: 1 });
pollSchema.index({ societyId: 1, targetBlockId: 1 });
pollSchema.index({ closingDate: 1 });

module.exports = pollSchema;
