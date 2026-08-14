"use strict";

const mongoose = require("mongoose");
const { NOTICE_TYPE, POLL_STATUS } = require("../../common/constants");

/**
 * NoticePoll — notice board posts and community polls.
 * Both entities share this collection (discriminated by `entryType`).
 * Lives in mysociety_operations.noticespolls
 */
const noticePollSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        postedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "postedBy is required"],
        },
        entryType: {
            type: String,
            enum: ["notice", "poll"],
            required: [true, "entryType is required"],
        },
        title: {
            type: String,
            required: [true, "Title is required"],
            trim: true,
        },
        content: {
            type: String,
            trim: true,
        },
        // Notice-specific
        noticeType: {
            type: String,
            enum: Object.values(NOTICE_TYPE),
        },
        attachments: [String],
        // Poll-specific
        pollStatus: {
            type: String,
            enum: Object.values(POLL_STATUS),
        },
        options: [
            {
                text: { type: String, required: true },
                votes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
            }
        ],
        pollDeadline: {
            type: Date,
        },
        postedAt: {
            type: Date,
            default: Date.now,
        },
        expiresAt: {
            type: Date,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
);

noticePollSchema.index({ societyId: 1, postedAt: -1 });
noticePollSchema.index({ societyId: 1, entryType: 1, postedAt: -1 });

module.exports = noticePollSchema;
