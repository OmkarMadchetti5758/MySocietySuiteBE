"use strict";

const AmenityBookingService = require("./amenityBooking.service");
const { sendSuccess } = require("../../utils/response.utils");

class AmenityBookingController {

    async createBooking(req, res, next) {
        try {
            const idempotencyKey = req.headers["x-idempotency-key"] || null;
            const booking = await AmenityBookingService.createBooking(
                req.societyId,
                req.user.id,
                req.user.flatId || null,
                req.body,
                idempotencyKey
            );
            return sendSuccess(res, 201, "Booking created successfully", booking);
        } catch (error) {
            next(error);
        }
    }

    async getBookings(req, res, next) {
        try {
            const bookings = await AmenityBookingService.getBookings(req.societyId, req.user, req.query);
            return sendSuccess(res, 200, "Bookings fetched successfully", bookings);
        } catch (error) {
            next(error);
        }
    }

    async cancelBooking(req, res, next) {
        try {
            const booking = await AmenityBookingService.cancelBooking(
                req.societyId,
                req.params.id,
                req.user,
                { cancellationReason: req.body.cancellationReason }
            );
            return sendSuccess(res, 200, "Booking cancelled successfully", booking);
        } catch (error) {
            next(error);
        }
    }

    async approveBooking(req, res, next) {
        try {
            const booking = await AmenityBookingService.approveBooking(
                req.societyId,
                req.params.id,
                req.user.id
            );
            return sendSuccess(res, 200, "Booking approved successfully", booking);
        } catch (error) {
            next(error);
        }
    }

    async rejectBooking(req, res, next) {
        try {
            const booking = await AmenityBookingService.rejectBooking(
                req.societyId,
                req.params.id,
                req.user.id,
                req.body.rejectionReason
            );
            return sendSuccess(res, 200, "Booking rejected successfully", booking);
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new AmenityBookingController();
