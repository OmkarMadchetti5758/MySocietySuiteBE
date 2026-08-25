"use strict";

const mongoose = require("mongoose");

const pollVoteSchema = new mongoose.Schema(
    {
        pollId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Poll",
            required: [true, "pollId is required"],
        },
        optionId: {
            type: mongoose.Schema.Types.ObjectId,
            required: [true, "optionId is required"],
        },
        residentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "residentId is required"],
        },
    },
    { timestamps: true }
);

// Unique constraint to prevent duplicate voting
pollVoteSchema.index({ pollId: 1, residentId: 1 }, { unique: true });

module.exports = pollVoteSchema;
