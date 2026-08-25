"use strict";

const mongoose = require("mongoose");
const { BOOKING_STATUS } = require("../../common/constants");

/**
 * AmenityBooking — a resident's reservation of a society amenity for a specific date+slot.
 * Lives in mysociety_operations.amenitybookings
 *
 * The unique index on {societyId, amenityId, date, slot} prevents double-booking
 * at the database level — not just application level.
 */
const amenityBookingSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        amenityId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Amenity",
            required: [true, "amenityId is required"],
        },
        bookedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "bookedBy is required"],
        },
        flatId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Flat",
        },
        date: {
            type: Date,
            required: [true, "Booking date is required"],
        },
        slotId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AmenitySlot",
            required: [true, "Time slot ID is required"],
        },
        status: {
            type: String,
            enum: Object.values(BOOKING_STATUS),
            default: BOOKING_STATUS.PENDING,
        },
        guestCount: {
            type: Number,
            default: 1,
        },
        notes: {
            type: String,
            trim: true,
        },
        rejectionReason: {
            type: String,
            trim: true,
        },
        cancellationReason: {
            type: String,
            trim: true,
        },
        cancelledAt: {
            type: Date,
        },
        approvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        approvedAt: {
            type: Date,
        },
        rejectedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        rejectedAt: {
            type: Date,
        },
    },
    { timestamps: true }
);

// DB-level double-booking prevention using partial unique index
amenityBookingSchema.index(
    { societyId: 1, amenityId: 1, date: 1, slotId: 1 },
    { 
        unique: true, 
        partialFilterExpression: { status: { $in: [BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED] } } 
    }
);
amenityBookingSchema.index({ societyId: 1, bookedBy: 1 });

module.exports = amenityBookingSchema;
