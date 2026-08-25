"use strict";

const { getOperationsConnection } = require("../../config/operationsDb");
const AppError = require("../../common/AppError");
const { BOOKING_STATUS } = require("../../common/constants");

class AmenityService {
    get Amenity() { return getOperationsConnection().model("Amenity"); }
    get AmenitySlot() { return getOperationsConnection().model("AmenitySlot"); }
    get AmenityBooking() { return getOperationsConnection().model("AmenityBooking"); }

    // ─── Amenity CRUD ────────────────────────────────────────────────────────────

    async createAmenity(societyId, userId, data) {
        const name = (data.name || "").trim();
        if (!name) throw new AppError("Amenity name is required", 400, "VALIDATION_ERROR");
        if (data.capacity !== undefined && data.capacity <= 0) {
            throw new AppError("Capacity must be a positive number", 400, "INVALID_CAPACITY");
        }
        if (data.maxBookingDuration !== undefined && data.maxBookingDuration < 1) {
            throw new AppError("Max booking duration must be at least 1 minute", 400, "INVALID_DURATION");
        }
        if (data.cancellationWindow !== undefined && data.cancellationWindow < 0) {
            throw new AppError("Cancellation window cannot be negative", 400, "INVALID_CANCELLATION_WINDOW");
        }
        if (data.advanceBookingLimit !== undefined && data.advanceBookingLimit < 0) {
            throw new AppError("Advance booking limit cannot be negative", 400, "INVALID_ADVANCE_LIMIT");
        }

        // Duplicate name check within the same society
        const existing = await this.Amenity.findOne({ societyId, name });
        if (existing) throw new AppError(`An amenity named '${name}' already exists`, 409, "DUPLICATE_AMENITY");

        const amenity = new this.Amenity({ ...data, name, societyId, createdBy: userId });
        await amenity.save();
        return amenity;
    }

    async getAmenities(societyId, query = {}) {
        const filter = { societyId };
        if (query.status) filter.status = query.status;
        return await this.Amenity.find(filter)
            .populate("createdBy", "name")
            .sort({ createdAt: -1 })
            .lean();
    }

    async getAmenityById(societyId, id) {
        const amenity = await this.Amenity.findOne({ _id: id, societyId }).lean();
        if (!amenity) throw new AppError("Amenity not found", 404, "AMENITY_NOT_FOUND");
        return amenity;
    }

    async updateAmenity(societyId, id, data) {
        const amenity = await this.Amenity.findOne({ _id: id, societyId });
        if (!amenity) throw new AppError("Amenity not found", 404, "AMENITY_NOT_FOUND");

        if (data.name && data.name.trim() !== amenity.name) {
            const duplicate = await this.Amenity.findOne({ societyId, name: data.name.trim(), _id: { $ne: id } });
            if (duplicate) throw new AppError("An amenity with this name already exists", 409, "DUPLICATE_AMENITY");
        }
        if (data.capacity !== undefined && data.capacity <= 0) {
            throw new AppError("Capacity must be a positive number", 400, "INVALID_CAPACITY");
        }

        Object.assign(amenity, data);
        await amenity.save();
        return amenity;
    }

    // ─── Slot CRUD ───────────────────────────────────────────────────────────────

    async createAmenitySlot(societyId, amenityId, userId, data) {
        // Verify amenity belongs to society
        const amenity = await this.Amenity.findOne({ _id: amenityId, societyId });
        if (!amenity) throw new AppError("Amenity not found", 404, "AMENITY_NOT_FOUND");

        const { startTime, endTime, dayOfWeek } = data;

        if (!startTime || !endTime || !dayOfWeek) {
            throw new AppError("startTime, endTime, and dayOfWeek are required", 400, "VALIDATION_ERROR");
        }
        if (startTime >= endTime) {
            throw new AppError("Start time must be before end time", 400, "INVALID_SLOT");
        }

        // Check for overlapping slots on the same day
        const existingSlots = await this.AmenitySlot.find({
            amenityId,
            societyId,
            dayOfWeek: { $in: [dayOfWeek, "All"] },
            status: "ACTIVE",
        });

        for (const slot of existingSlots) {
            const overlaps = (
                (startTime >= slot.startTime && startTime < slot.endTime) ||
                (endTime > slot.startTime && endTime <= slot.endTime) ||
                (startTime <= slot.startTime && endTime >= slot.endTime)
            );
            if (overlaps) throw new AppError(`Slot overlaps with existing slot (${slot.startTime}–${slot.endTime})`, 409, "SLOT_OVERLAP");
        }

        const slot = new this.AmenitySlot({ ...data, amenityId, societyId, createdBy: userId });
        await slot.save();
        return slot;
    }

    async getAmenitySlots(societyId, amenityId) {
        // Verify amenity belongs to society first
        await this.getAmenityById(societyId, amenityId);
        return await this.AmenitySlot.find({ amenityId, societyId }).sort({ dayOfWeek: 1, startTime: 1 }).lean();
    }

    async updateAmenitySlot(societyId, amenityId, slotId, data) {
        // Verify amenity
        await this.getAmenityById(societyId, amenityId);

        const slot = await this.AmenitySlot.findOne({ _id: slotId, amenityId, societyId });
        if (!slot) throw new AppError("Slot not found", 404, "SLOT_NOT_FOUND");

        // If deactivating slot, check for future active bookings
        if (data.status === "INACTIVE" && slot.status === "ACTIVE") {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const futureBookings = await this.AmenityBooking.countDocuments({
                slotId,
                date: { $gte: today },
                status: { $in: [BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED] },
            });
            if (futureBookings > 0) {
                throw new AppError(
                    `Cannot deactivate: ${futureBookings} future booking(s) exist on this slot`,
                    409,
                    "SLOT_HAS_FUTURE_BOOKINGS"
                );
            }
        }

        Object.assign(slot, data);
        await slot.save();
        return slot;
    }

    // ─── Availability ────────────────────────────────────────────────────────────

    async checkAvailability(societyId, amenityId, dateStr) {
        const amenity = await this.Amenity.findOne({ _id: amenityId, societyId }).lean();
        if (!amenity) throw new AppError("Amenity not found", 404, "AMENITY_NOT_FOUND");
        if (amenity.status !== "ACTIVE") throw new AppError("Amenity is inactive", 400, "AMENITY_INACTIVE");

        if (!dateStr) throw new AppError("Date is required (YYYY-MM-DD)", 400, "INVALID_BOOKING_DATE");

        const targetDate = new Date(dateStr);
        if (isNaN(targetDate.getTime())) throw new AppError("Invalid date format. Use YYYY-MM-DD", 400, "INVALID_BOOKING_DATE");
        targetDate.setHours(0, 0, 0, 0);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (targetDate < today) throw new AppError("Cannot check availability for past dates", 400, "INVALID_BOOKING_DATE");

        const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const dayOfWeek = DAYS[targetDate.getDay()];

        const slots = await this.AmenitySlot.find({
            amenityId,
            societyId,
            status: "ACTIVE",
            dayOfWeek: { $in: [dayOfWeek, "All"] },
        }).lean();

        // Find existing active bookings for this date/amenity
        const bookedSlotIds = await this.AmenityBooking.distinct("slotId", {
            amenityId,
            societyId,
            date: targetDate,
            status: { $in: [BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED] },
        });

        const bookedSet = new Set(bookedSlotIds.map(id => id.toString()));

        // Filter out slots that have already started (for same-day bookings)
        const nowTime = new Date();
        const nowHHMM = `${String(nowTime.getHours()).padStart(2, "0")}:${String(nowTime.getMinutes()).padStart(2, "0")}`;

        const availability = slots.map(slot => {
            const isBooked = bookedSet.has(slot._id.toString());
            // For same day — slot must not have started yet
            const slotStarted = targetDate.getTime() === today.getTime() && slot.startTime <= nowHHMM;
            return {
                ...slot,
                isAvailable: !isBooked && !slotStarted,
                unavailableReason: isBooked ? "SLOT_ALREADY_BOOKED" : slotStarted ? "SLOT_ALREADY_STARTED" : null,
            };
        });

        return { amenity, date: targetDate, slots: availability };
    }
}

module.exports = new AmenityService();
