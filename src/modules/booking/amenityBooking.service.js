"use strict";

const mongoose = require("mongoose");
const { getOperationsConnection } = require("../../config/operationsDb");
const AppError = require("../../common/AppError");
const { BOOKING_STATUS, ROLES } = require("../../common/constants");

// In-memory idempotency store (per BRD §40; use Redis in production for multi-instance)
const idempotencyStore = new Map();

class AmenityBookingService {
    get Amenity() { return getOperationsConnection().model("Amenity"); }
    get AmenitySlot() { return getOperationsConnection().model("AmenitySlot"); }
    get AmenityBooking() { return getOperationsConnection().model("AmenityBooking"); }

    // ─── Create Booking (transactional, idempotency-safe) ────────────────────────
    async createBooking(societyId, userId, flatId, data, idempotencyKey) {
        // Idempotency check
        if (idempotencyKey && idempotencyStore.has(idempotencyKey)) {
            return idempotencyStore.get(idempotencyKey);
        }

        const { amenityId, slotId, date: dateStr } = data;
        if (!amenityId || !slotId || !dateStr) {
            throw new AppError("amenityId, slotId, and date are required", 400, "VALIDATION_ERROR");
        }

        // ── Date validation ──────────────────────────────────────────────────────
        const targetDate = new Date(dateStr);
        if (isNaN(targetDate.getTime())) {
            throw new AppError("Invalid date format. Use YYYY-MM-DD", 400, "INVALID_BOOKING_DATE");
        }
        targetDate.setHours(0, 0, 0, 0);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (targetDate < today) {
            throw new AppError("Cannot book a date in the past", 400, "INVALID_BOOKING_DATE");
        }

        // ── Amenity validation ───────────────────────────────────────────────────
        const amenity = await this.Amenity.findOne({ _id: amenityId, societyId });
        if (!amenity) throw new AppError("Amenity not found", 404, "AMENITY_NOT_FOUND");
        if (amenity.status !== "ACTIVE") throw new AppError("Amenity is inactive", 400, "AMENITY_INACTIVE");

        // ── Advance booking limit ────────────────────────────────────────────────
        const maxDate = new Date(today);
        maxDate.setDate(maxDate.getDate() + amenity.advanceBookingLimit);
        if (targetDate > maxDate) {
            throw new AppError(
                `Bookings can only be made up to ${amenity.advanceBookingLimit} days in advance`,
                400,
                "BOOKING_TOO_FAR_IN_ADVANCE"
            );
        }

        // ── Slot validation ──────────────────────────────────────────────────────
        const slot = await this.AmenitySlot.findOne({ _id: slotId, amenityId, societyId });
        if (!slot) throw new AppError("Slot not found", 404, "SLOT_NOT_FOUND");
        if (slot.status !== "ACTIVE") throw new AppError("Slot is inactive", 400, "INVALID_SLOT");

        // Same-day check: slot must not have started yet
        if (targetDate.getTime() === today.getTime()) {
            const now = new Date();
            const nowHHMM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
            if (slot.startTime <= nowHHMM) {
                throw new AppError("Cannot book a slot that has already started today", 400, "INVALID_SLOT");
            }
        }

        // ── Status based on approval config ────────────────────────────────────
        const status = amenity.requiresApproval ? BOOKING_STATUS.PENDING : BOOKING_STATUS.CONFIRMED;

        // ── Transaction: lock + insert ──────────────────────────────────────────
        const session = await getOperationsConnection().startSession();
        session.startTransaction();
        let booking;

        try {
            // Re-check availability inside the transaction (prevents race conditions)
            const conflict = await this.AmenityBooking.findOne({
                societyId,
                amenityId,
                slotId,
                date: targetDate,
                status: { $in: [BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED] },
            }).session(session);

            if (conflict) {
                await session.abortTransaction();
                session.endSession();
                throw new AppError("Slot is already booked", 409, "SLOT_ALREADY_BOOKED");
            }

            booking = new this.AmenityBooking({
                societyId,
                amenityId,
                slotId,
                date: targetDate,
                bookedBy: userId,
                flatId: flatId || null,
                status,
                notes: data.notes || null,
            });

            await booking.save({ session });
            await session.commitTransaction();
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            // MongoDB duplicate key error (unique index as secondary safety net)
            if (error.code === 11000) {
                throw new AppError("Slot is already booked", 409, "SLOT_ALREADY_BOOKED");
            }
            throw error;
        }

        session.endSession();

        // Cache for idempotency (5 minutes TTL)
        if (idempotencyKey) {
            idempotencyStore.set(idempotencyKey, booking);
            setTimeout(() => idempotencyStore.delete(idempotencyKey), 5 * 60 * 1000);
        }

        return booking;
    }

    // ─── Get Bookings (role-scoped) ──────────────────────────────────────────────
    async getBookings(societyId, user, query = {}) {
        const filter = { societyId };
        const adminRoles = [ROLES.ADMIN, ROLES.COMMITTEE_MEMBER, ROLES.FACILITY_MANAGER];
        const userRoles = user.roleKeys || [user.role];

        const isAdmin = userRoles.some(r => adminRoles.includes(r));
        // Residents only see their own bookings
        if (!isAdmin) {
            filter.bookedBy = user.id;
        }

        if (query.amenityId) filter.amenityId = query.amenityId;
        if (query.status) filter.status = query.status;
        if (query.date) {
            const d = new Date(query.date);
            d.setHours(0, 0, 0, 0);
            filter.date = d;
        }

        return await this.AmenityBooking.find(filter)
            .populate("amenityId", "name requiresApproval")
            .populate("slotId", "startTime endTime dayOfWeek")
            .populate("bookedBy", "name email")
            .populate("approvedBy", "name")
            .populate("rejectedBy", "name")
            .sort({ createdAt: -1 })
            .lean();
    }

    // ─── Cancel Booking ──────────────────────────────────────────────────────────
    async cancelBooking(societyId, bookingId, user, data = {}) {
        const booking = await this.AmenityBooking.findOne({ _id: bookingId, societyId });
        if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");

        const adminRoles = [ROLES.ADMIN, ROLES.COMMITTEE_MEMBER, ROLES.FACILITY_MANAGER];
        const userRoles = user.roleKeys || [user.role];
        const isAdmin = userRoles.some(r => adminRoles.includes(r));

        // Residents can only cancel their own
        if (!isAdmin && booking.bookedBy.toString() !== user.id.toString()) {
            throw new AppError("You are not authorized to cancel this booking", 403, "UNAUTHORIZED_BOOKING");
        }

        if (booking.status === BOOKING_STATUS.CANCELLED) {
            throw new AppError("Booking is already cancelled", 400, "BOOKING_ALREADY_CANCELLED");
        }
        if (booking.status === BOOKING_STATUS.REJECTED) {
            throw new AppError("Cannot cancel a rejected booking", 400, "BOOKING_ALREADY_REJECTED");
        }
        if (booking.status === BOOKING_STATUS.COMPLETED) {
            throw new AppError("Cannot cancel a completed booking", 400, "INVALID_BOOKING_STATUS");
        }

        // Resident cancellation window check (admins bypass)
        if (!isAdmin) {
            const amenity = await this.Amenity.findById(booking.amenityId);
            const slot = await this.AmenitySlot.findById(booking.slotId);
            if (amenity && slot) {
                const bookingStart = new Date(booking.date);
                const [hours, minutes] = slot.startTime.split(":").map(Number);
                bookingStart.setHours(hours, minutes, 0, 0);

                const hoursUntilBooking = (bookingStart.getTime() - Date.now()) / (1000 * 3600);
                if (hoursUntilBooking < amenity.cancellationWindow) {
                    throw new AppError(
                        `Cancellation window has expired. You must cancel at least ${amenity.cancellationWindow} hour(s) before the booking.`,
                        400,
                        "CANCELLATION_WINDOW_EXPIRED"
                    );
                }
            }
        }

        booking.status = BOOKING_STATUS.CANCELLED;
        booking.cancellationReason = data.cancellationReason || (isAdmin ? "Cancelled by admin" : "Cancelled by resident");
        booking.cancelledAt = new Date();
        await booking.save();
        return booking;
    }

    // ─── Approve Booking ─────────────────────────────────────────────────────────
    async approveBooking(societyId, bookingId, userId) {
        const booking = await this.AmenityBooking.findOne({ _id: bookingId, societyId });
        if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");

        if (booking.status !== BOOKING_STATUS.PENDING) {
            throw new AppError(
                `Cannot approve a booking with status '${booking.status}'`,
                400,
                "APPROVAL_NOT_ALLOWED"
            );
        }

        // Validate amenity is still active before approving
        const amenity = await this.Amenity.findOne({ _id: booking.amenityId, societyId });
        if (!amenity || amenity.status !== "ACTIVE") {
            throw new AppError("Amenity is no longer active", 400, "AMENITY_INACTIVE");
        }

        booking.status = BOOKING_STATUS.CONFIRMED;
        booking.approvedBy = userId;
        booking.approvedAt = new Date();
        await booking.save();
        return booking;
    }

    // ─── Reject Booking ──────────────────────────────────────────────────────────
    async rejectBooking(societyId, bookingId, userId, rejectionReason) {
        if (!rejectionReason || !rejectionReason.trim()) {
            throw new AppError("Rejection reason is required", 400, "VALIDATION_ERROR");
        }

        const booking = await this.AmenityBooking.findOne({ _id: bookingId, societyId });
        if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");

        if (booking.status !== BOOKING_STATUS.PENDING) {
            throw new AppError(
                `Cannot reject a booking with status '${booking.status}'`,
                400,
                "INVALID_BOOKING_STATUS"
            );
        }

        booking.status = BOOKING_STATUS.REJECTED;
        booking.rejectionReason = rejectionReason.trim();
        booking.rejectedBy = userId;
        booking.rejectedAt = new Date();
        await booking.save();
        return booking;
    }
}

module.exports = new AmenityBookingService();
