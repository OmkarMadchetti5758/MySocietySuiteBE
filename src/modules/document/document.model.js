"use strict";

const mongoose = require("mongoose");
const { DOCUMENT_TYPE } = require("../../common/constants");

/**
 * Document — society documents (meeting minutes, circulars, legal papers, etc.)
 * Lives in mysociety_operations.documents
 */
const documentSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        title: {
            type: String,
            required: [true, "Document title is required"],
            trim: true,
        },
        category: {
            type: String,
            enum: Object.values(DOCUMENT_TYPE),
            required: [true, "Document category is required"],
        },
        description: {
            type: String,
            trim: true,
        },
        fileUrl: {
            type: String,
            required: [true, "File URL is required"],
            trim: true,
        },
        fileName: {
            type: String,
            trim: true,
        },
        fileSize: {
            type: Number, // in bytes
        },
        uploadedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "uploadedBy is required"],
        },
        isPublic: {
            type: Boolean,
            default: false,
            // true = visible to all society residents; false = committee-only
        },
        tags: [String],
    },
    { timestamps: true }
);

documentSchema.index({ societyId: 1, category: 1 });
documentSchema.index({ societyId: 1, isPublic: 1 });

module.exports = documentSchema;
