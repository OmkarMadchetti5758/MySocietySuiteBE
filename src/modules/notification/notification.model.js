"use strict";

const mongoose = require("mongoose");
const { NOTIFICATION_TYPE } = require("../../common/constants");

/**
 * Notification — push/in-app notifications sent to residents.
 * Lives in mysociety_operations.notifications
 */
const notificationSchema = new mongoose.Schema(
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
        title: {
            type: String,
            required: [true, "Title is required"],
            trim: true,
        },
        body: {
            type: String,
            required: [true, "Notification body is required"],
            trim: true,
        },
        type: {
            type: String,
            enum: Object.values(NOTIFICATION_TYPE),
            default: NOTIFICATION_TYPE.GENERAL,
        },
        isRead: {
            type: Boolean,
            default: false,
        },
        sentAt: {
            type: Date,
            default: Date.now,
        },
        readAt: {
            type: Date,
        },
        referenceId: {
            type: mongoose.Schema.Types.ObjectId,
            // Points to the document that triggered this notification (e.g. complaint _id, bill _id)
        },
        referenceModel: {
            type: String, // e.g. "Complaint", "MaintenanceBill"
        },
    },
    { timestamps: true }
);

notificationSchema.index({ societyId: 1, userId: 1, sentAt: -1 });
notificationSchema.index({ societyId: 1, userId: 1, isRead: 1 });

module.exports = notificationSchema;
