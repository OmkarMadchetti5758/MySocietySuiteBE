"use strict";

const mongoose = require("mongoose");

/**
 * AI knowledge-base content available to the assistant.
 * Lives in mysociety_operations.aiKnowledgeBase.
 */
const aiKnowledgeBaseSchema = new mongoose.Schema(
    {
        category: {
            type: String,
            required: [true, "Category is required"],
            trim: true,
        },
        topic: {
            type: String,
            required: [true, "Topic is required"],
            trim: true,
        },
        title: {
            type: String,
            required: [true, "Title is required"],
            trim: true,
        },
        content: {
            en: {
                type: String,
                required: [true, "English content is required"],
                trim: true,
            },
            hi: {
                type: String,
                trim: true,
            },
            mr: {
                type: String,
                trim: true,
            },
        },
        allowedRoles: {
            type: [String],
            default: [],
        },
        keywords: {
            type: [String],
            default: [],
        },
        status: {
            type: String,
            enum: ["active", "inactive"],
            default: "active",
        },
    },
    { timestamps: true, collection: "aiKnowledgeBase" }
);

aiKnowledgeBaseSchema.index({ category: 1 });
aiKnowledgeBaseSchema.index({ topic: 1 });
aiKnowledgeBaseSchema.index({ status: 1 });
aiKnowledgeBaseSchema.index({ keywords: 1 });

module.exports = aiKnowledgeBaseSchema;
