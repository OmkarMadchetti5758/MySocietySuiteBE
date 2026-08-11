"use strict";

const mongoose = require("mongoose");

/**
 * AIAssistantQueryLog — logs every query sent to the AI assistant, per user per society.
 * Lives in mysociety_operations.aiassistantquerylogs
 */
const aiAssistantQueryLogSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "userId is required"],
        },
        query: {
            type: String,
            required: [true, "Query is required"],
            trim: true,
        },
        response: {
            type: String,
            trim: true,
        },
        timestamp: {
            type: Date,
            default: Date.now,
        },
        durationMs: {
            type: Number, // Time taken to generate response
        },
        model: {
            type: String, // e.g. "gemini-pro", "gpt-4"
            trim: true,
        },
        tokensUsed: {
            type: Number,
        },
        context: {
            type: mongoose.Schema.Types.Mixed, // Optional metadata about the query context
        },
        successful: {
            type: Boolean,
            default: true,
        },
        errorMessage: {
            type: String,
        },
    },
    { timestamps: true }
);

// Latest queries per user within a society (most common query pattern)
aiAssistantQueryLogSchema.index({ societyId: 1, userId: 1, timestamp: -1 });
// Society-level audit view
aiAssistantQueryLogSchema.index({ societyId: 1, timestamp: -1 });

module.exports = aiAssistantQueryLogSchema;
