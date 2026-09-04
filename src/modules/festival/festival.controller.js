"use strict";

const { getOperationsConnection } = require("../../config/operationsDb");
const AppError = require("../../common/AppError");
const { sendSuccess, sendPaginated } = require("../../utils/response.utils");
const { FESTIVAL_STATUS, ROLES, PAGINATION } = require("../../common/constants");

const getFestivalModel = () => getOperationsConnection().model("Festival");

// Helper to check venue conflicts
const checkVenueConflict = async (societyId, venue, date, startTime, endTime, excludeFestivalId = null) => {
    const Festival = getFestivalModel();
    const query = {
        societyId,
        venue,
        date: new Date(date),
        status: { $ne: FESTIVAL_STATUS.CANCELLED }
    };
    if (excludeFestivalId) {
        query._id = { $ne: excludeFestivalId };
    }

    const conflictingEvents = await Festival.find(query);
    for (const event of conflictingEvents) {
        // Interval overlap logic: newStart < existingEnd AND newEnd > existingStart
        if (startTime < event.endTime && endTime > event.startTime) {
            return true; // Conflict found
        }
    }
    return false;
};

// Create a new festival
exports.createFestival = async (req, res, next) => {
    try {
        const Festival = getFestivalModel();
        const { title, description, date, startTime, endTime, venue, image } = req.body;
        const societyId = req.societyId;

        const hasConflict = await checkVenueConflict(societyId, venue, date, startTime, endTime);
        if (hasConflict) {
            return next(new AppError("VENUE_CONFLICT", 409, "VENUE_CONFLICT"));
        }

        const festival = await Festival.create({
            societyId,
            title,
            description,
            date: new Date(date),
            startTime,
            endTime,
            venue,
            image,
            status: FESTIVAL_STATUS.DRAFT,
            createdBy: req.user.id,
        });

        return sendSuccess(res, 201, "Festival created successfully", { festival });
    } catch (error) {
        next(error);
    }
};

// Get all festivals with pagination and filters
exports.getFestivals = async (req, res, next) => {
    try {
        const Festival = getFestivalModel();
        const { page = PAGINATION.DEFAULT_PAGE, limit = PAGINATION.DEFAULT_LIMIT, status, venue, sort } = req.query;
        const societyId = req.societyId;

        const query = { societyId };

        // Residents only see published events
        const isResident = [ROLES.RESIDENT_OWNER, ROLES.RESIDENT_TENANT].includes(req.user.role);
        if (isResident) {
            query.status = FESTIVAL_STATUS.PUBLISHED;
        } else if (status) {
            query.status = status;
        }

        if (venue) {
            query.venue = new RegExp(venue, "i");
        }

        let sortOption = { date: 1, startTime: 1 };
        if (sort === "desc") {
            sortOption = { date: -1, startTime: -1 };
        } else if (sort === "newest") {
            sortOption = { createdAt: -1 };
        }

        const skip = (page - 1) * limit;

        const festivals = await Festival.find(query)
            .sort(sortOption)
            .skip(skip)
            .limit(parseInt(limit))
            .populate("createdBy", "name email")
            .populate("updatedBy", "name email");

        const total = await Festival.countDocuments(query);
        const totalPages = Math.ceil(total / limit);

        return sendPaginated(res, 200, "Festivals fetched successfully", festivals, {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages,
        });
    } catch (error) {
        next(error);
    }
};

// Get single festival by ID
exports.getFestivalById = async (req, res, next) => {
    try {
        const Festival = getFestivalModel();
        const { id } = req.params;
        const societyId = req.societyId;

        const festival = await Festival.findOne({ _id: id, societyId })
            .populate("createdBy", "name email")
            .populate("updatedBy", "name email");

        if (!festival) {
            return next(new AppError("FESTIVAL_NOT_FOUND", 404, "FESTIVAL_NOT_FOUND"));
        }

        const isResident = [ROLES.RESIDENT_OWNER, ROLES.RESIDENT_TENANT].includes(req.user.role);
        if (isResident && festival.status !== FESTIVAL_STATUS.PUBLISHED) {
            return next(new AppError("UNAUTHORIZED_FESTIVAL_ACCESS", 403, "UNAUTHORIZED_FESTIVAL_ACCESS"));
        }

        return sendSuccess(res, 200, "Festival fetched successfully", { festival });
    } catch (error) {
        next(error);
    }
};

// Update festival
exports.updateFestival = async (req, res, next) => {
    try {
        const Festival = getFestivalModel();
        const { id } = req.params;
        const societyId = req.societyId;
        const updates = req.body;

        const festival = await Festival.findOne({ _id: id, societyId });
        if (!festival) {
            return next(new AppError("FESTIVAL_NOT_FOUND", 404, "FESTIVAL_NOT_FOUND"));
        }

        if (festival.status === FESTIVAL_STATUS.COMPLETED || festival.status === FESTIVAL_STATUS.CANCELLED) {
            return next(new AppError("INVALID_STATUS_TRANSITION", 400, "INVALID_STATUS_TRANSITION"));
        }

        // Check for venue conflict if venue/date/times are changing
        if (updates.venue || updates.date || updates.startTime || updates.endTime) {
            const date = updates.date || festival.date;
            const startTime = updates.startTime || festival.startTime;
            const endTime = updates.endTime || festival.endTime;
            const venue = updates.venue || festival.venue;

            const hasConflict = await checkVenueConflict(societyId, venue, date, startTime, endTime, id);
            if (hasConflict) {
                return next(new AppError("VENUE_CONFLICT", 409, "VENUE_CONFLICT"));
            }
        }

        // Prevent modification of immutable fields
        delete updates.societyId;
        delete updates.createdBy;
        delete updates.status; // status changed via specific endpoints

        Object.assign(festival, updates);
        festival.updatedBy = req.user.id;

        await festival.save();

        return sendSuccess(res, 200, "Festival updated successfully", { festival });
    } catch (error) {
        next(error);
    }
};

// Publish festival
exports.publishFestival = async (req, res, next) => {
    try {
        const Festival = getFestivalModel();
        const { id } = req.params;
        const societyId = req.societyId;

        const festival = await Festival.findOne({ _id: id, societyId });
        if (!festival) {
            return next(new AppError("FESTIVAL_NOT_FOUND", 404, "FESTIVAL_NOT_FOUND"));
        }

        if (festival.status === FESTIVAL_STATUS.PUBLISHED) {
            return sendSuccess(res, 200, "Festival already published", { festival });
        }

        if (festival.status !== FESTIVAL_STATUS.DRAFT) {
            return next(new AppError("INVALID_STATUS_TRANSITION", 400, "INVALID_STATUS_TRANSITION"));
        }

        festival.status = FESTIVAL_STATUS.PUBLISHED;
        festival.updatedBy = req.user.id;
        await festival.save();

        return sendSuccess(res, 200, "Festival published successfully", { festival });
    } catch (error) {
        next(error);
    }
};

// Unpublish festival
exports.unpublishFestival = async (req, res, next) => {
    try {
        const Festival = getFestivalModel();
        const { id } = req.params;
        const societyId = req.societyId;

        const festival = await Festival.findOne({ _id: id, societyId });
        if (!festival) {
            return next(new AppError("FESTIVAL_NOT_FOUND", 404, "FESTIVAL_NOT_FOUND"));
        }

        if (festival.status === FESTIVAL_STATUS.DRAFT) {
            return sendSuccess(res, 200, "Festival already unpublished", { festival });
        }

        if (festival.status !== FESTIVAL_STATUS.PUBLISHED) {
            return next(new AppError("INVALID_STATUS_TRANSITION", 400, "INVALID_STATUS_TRANSITION"));
        }

        festival.status = FESTIVAL_STATUS.DRAFT;
        festival.updatedBy = req.user.id;
        await festival.save();

        return sendSuccess(res, 200, "Festival unpublished successfully", { festival });
    } catch (error) {
        next(error);
    }
};

// Cancel festival
exports.cancelFestival = async (req, res, next) => {
    try {
        const Festival = getFestivalModel();
        const { id } = req.params;
        const societyId = req.societyId;

        const festival = await Festival.findOne({ _id: id, societyId });
        if (!festival) {
            return next(new AppError("FESTIVAL_NOT_FOUND", 404, "FESTIVAL_NOT_FOUND"));
        }

        if (festival.status === FESTIVAL_STATUS.CANCELLED) {
            return sendSuccess(res, 200, "Festival already cancelled", { festival });
        }

        if (festival.status === FESTIVAL_STATUS.COMPLETED) {
            return next(new AppError("INVALID_STATUS_TRANSITION", 400, "INVALID_STATUS_TRANSITION"));
        }

        festival.status = FESTIVAL_STATUS.CANCELLED;
        festival.updatedBy = req.user.id;
        await festival.save();

        return sendSuccess(res, 200, "Festival cancelled successfully", { festival });
    } catch (error) {
        next(error);
    }
};

// Delete festival
exports.deleteFestival = async (req, res, next) => {
    try {
        const Festival = getFestivalModel();
        const { id } = req.params;
        const societyId = req.societyId;

        const festival = await Festival.findOne({ _id: id, societyId });
        if (!festival) {
            return next(new AppError("FESTIVAL_NOT_FOUND", 404, "FESTIVAL_NOT_FOUND"));
        }

        if (festival.status !== FESTIVAL_STATUS.DRAFT) {
            return next(new AppError("INVALID_STATUS_TRANSITION", 400, "Cannot delete non-draft events. Cancel them instead."));
        }

        await festival.deleteOne();

        return sendSuccess(res, 200, "Festival deleted successfully");
    } catch (error) {
        next(error);
    }
};
