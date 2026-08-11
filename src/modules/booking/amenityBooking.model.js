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
        slot: {
            type: String,
            required: [true, "Time slot is required"],
            trim: true, // e.g. "10:00-11:00"
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
        approvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
    },
    { timestamps: true }
);

// DB-level double-booking prevention
amenityBookingSchema.index(
    { societyId: 1, amenityId: 1, date: 1, slot: 1 },
    { unique: true }
);
amenityBookingSchema.index({ societyId: 1, bookedBy: 1 });

module.exports = amenityBookingSchema;
