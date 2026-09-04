"use strict";

const { getOperationsConnection } = require("../../config/operationsDb");
const AppError = require("../../common/AppError");
const {
    PARKING_STATUS,
    PARKING_ASSIGNMENT_STATUS,
    PARKING_ASSIGNMENT_TYPE,
    VISITOR_PARKING_STATUS,
    PARKING_REQUEST_STATUS,
    PARKING_TYPE,
    VEHICLE_TYPE,
    ROLES,
} = require("../../common/constants");
const { getPaginationOptions, buildPaginationMeta } = require("../../utils/pagination.utils");

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Normalize vehicle registration number: uppercase, strip spaces/hyphens.
 * "mh 12 ab 1234" → "MH12AB1234"
 */
const normalizeRegNumber = (regNumber) =>
    (regNumber || "").toUpperCase().replace(/[\s-]/g, "");

/**
 * Resident-role check helper.
 */
const isResidentRole = (role) =>
    [ROLES.RESIDENT_OWNER, ROLES.RESIDENT_TENANT, ROLES.RESIDENT].includes(role);

/**
 * Admin/Manager-role check helper (can manage parking).
 */
const isManagerRole = (role) =>
    [ROLES.ADMIN, ROLES.COMMITTEE_MEMBER, ROLES.GUARD_MANAGER, ROLES.FACILITY_MANAGER].includes(role);

// ── Slot helpers ───────────────────────────────────────────────────────────────

/**
 * Fetch and assert a parking slot belongs to the society.
 */
const getSlotOrThrow = async (db, slotId, societyId) => {
    const ParkingSlot = db.model("ParkingSlot");
    const slot = await ParkingSlot.findOne({ _id: slotId, societyId }).lean();
    if (!slot) throw new AppError("Parking slot not found.", 404, "PARKING_SLOT_NOT_FOUND");
    return slot;
};

/**
 * Validate: slot is active and available.
 */
const assertSlotAvailable = (slot) => {
    if (!slot.isActive || slot.status === PARKING_STATUS.INACTIVE)
        throw new AppError("Parking slot is inactive.", 409, "PARKING_SLOT_INACTIVE");
    if (slot.status === PARKING_STATUS.MAINTENANCE)
        throw new AppError("Parking slot is under maintenance.", 409, "PARKING_SLOT_IN_MAINTENANCE");
    if (slot.status !== PARKING_STATUS.AVAILABLE)
        throw new AppError("Parking slot is not available.", 409, "PARKING_SLOT_NOT_AVAILABLE");
};

// ── Resident/Flat helpers ──────────────────────────────────────────────────────

/**
 * Validate that userId belongs to the society and return resident + flat.
 */
const getResidentContextOrThrow = async (db, userId, societyId) => {
    const Resident = db.model("Resident");
    const resident = await Resident.findOne({ userId, societyId, isActive: true }).lean();
    if (!resident) throw new AppError("Resident not found in this society.", 404, "RESIDENT_NOT_FOUND");
    return resident;
};

/**
 * Validate that a flat belongs to the society.
 */
const getFlatOrThrow = async (db, flatId, societyId) => {
    const Flat = db.model("Flat");
    const flat = await Flat.findOne({ _id: flatId, societyId }).lean();
    if (!flat) throw new AppError("Flat not found in this society.", 404, "FLAT_NOT_FOUND");
    return flat;
};

/**
 * Validate that resident is linked to flat.
 */
const assertResidentInFlat = (resident, flatId) => {
    if (String(resident.flatId) !== String(flatId))
        throw new AppError("Resident is not associated with the specified flat.", 400, "INVALID_RESIDENT_FLAT");
};

// ── Vehicle helpers ────────────────────────────────────────────────────────────

/**
 * Fetch an active vehicle, assert it belongs to the society.
 */
const getVehicleOrThrow = async (db, vehicleId, societyId) => {
    const Vehicle = db.model("Vehicle");
    const vehicle = await Vehicle.findOne({ _id: vehicleId, societyId, isActive: true }).lean();
    if (!vehicle) throw new AppError("Vehicle not found.", 404, "VEHICLE_NOT_FOUND");
    return vehicle;
};

/**
 * Assert vehicle belongs to the userId.
 */
const assertVehicleOwnership = (vehicle, userId) => {
    if (String(vehicle.userId) !== String(userId))
        throw new AppError("Vehicle does not belong to this resident.", 403, "UNAUTHORIZED_PARKING_ACCESS");
};

// ══════════════════════════════════════════════════════════════════════════════
// ── PARKING SLOT SERVICE ──────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

const ParkingService = {

    // ── Slots ──────────────────────────────────────────────────────────────────

    async createSlot({ societyId, userId, body }) {
        const db = getOperationsConnection();
        const ParkingSlot = db.model("ParkingSlot");

        const { slotNumber, type, floor, wing, location } = body;

        try {
            const slot = await ParkingSlot.create({
                societyId,
                slotNumber: (slotNumber || "").toUpperCase().trim(),
                type,
                floor,
                wing,
                location,
                status: PARKING_STATUS.AVAILABLE,
                isActive: true,
                createdBy: userId,
                updatedBy: userId,
            });
            return slot;
        } catch (err) {
            if (err.code === 11000)
                throw new AppError(`Slot number "${slotNumber}" already exists in this society.`, 409, "PARKING_SLOT_DUPLICATE");
            throw err;
        }
    },

    async listSlots({ societyId, query }) {
        const db = getOperationsConnection();
        const ParkingSlot = db.model("ParkingSlot");
        const { page, limit, skip } = getPaginationOptions(query);

        const filter = { societyId };
        if (query.status)  filter.status = query.status;
        if (query.type)    filter.type   = query.type;
        if (query.wing)    filter.wing   = query.wing;
        if (query.floor)   filter.floor  = query.floor;
        if (query.isActive !== undefined) filter.isActive = query.isActive === "true";
        if (query.search)  filter.slotNumber = { $regex: query.search, $options: "i" };

        const [slots, total] = await Promise.all([
            ParkingSlot.find(filter).sort({ slotNumber: 1 }).skip(skip).limit(limit).lean(),
            ParkingSlot.countDocuments(filter),
        ]);

        return { slots, meta: buildPaginationMeta(total, page, limit) };
    },

    async getSlotById({ slotId, societyId }) {
        const db = getOperationsConnection();
        return await getSlotOrThrow(db, slotId, societyId);
    },

    async updateSlot({ slotId, societyId, userId, body, version }) {
        const db = getOperationsConnection();
        const ParkingSlot = db.model("ParkingSlot");

        const allowedUpdates = ["floor", "wing", "location", "type"];
        const updates = {};
        for (const key of allowedUpdates) {
            if (body[key] !== undefined) updates[key] = body[key];
        }
        updates.updatedBy = userId;

        // Optimistic concurrency: version must match
        const filter = { _id: slotId, societyId };
        if (version !== undefined) filter.version = Number(version);

        const updated = await ParkingSlot.findOneAndUpdate(
            filter,
            { $set: updates, $inc: { version: 1 } },
            { new: true, runValidators: true }
        );

        if (!updated) {
            const exists = await ParkingSlot.findOne({ _id: slotId, societyId }).lean();
            if (!exists) throw new AppError("Parking slot not found.", 404, "PARKING_SLOT_NOT_FOUND");
            throw new AppError("Slot data was changed by another user. Please refresh.", 409, "STALE_PARKING_DATA");
        }
        return updated;
    },

    async activateSlot({ slotId, societyId, userId }) {
        const db = getOperationsConnection();
        const ParkingSlot = db.model("ParkingSlot");

        const updated = await ParkingSlot.findOneAndUpdate(
            { _id: slotId, societyId },
            { $set: { isActive: true, status: PARKING_STATUS.AVAILABLE, updatedBy: userId }, $inc: { version: 1 } },
            { new: true }
        );
        if (!updated) throw new AppError("Parking slot not found.", 404, "PARKING_SLOT_NOT_FOUND");
        return updated;
    },

    async deactivateSlot({ slotId, societyId, userId }) {
        const db = getOperationsConnection();
        const ParkingSlot = db.model("ParkingSlot");
        const ParkingAssignment = db.model("ParkingAssignment");

        const slot = await getSlotOrThrow(db, slotId, societyId);

        // Cannot deactivate if there is an active assignment
        const activeAssignment = await ParkingAssignment.findOne({
            parkingSlotId: slotId,
            status: PARKING_ASSIGNMENT_STATUS.ACTIVE,
        }).lean();

        if (activeAssignment)
            throw new AppError(
                "Cannot deactivate slot: it has an active parking assignment. Release the assignment first.",
                409,
                "PARKING_SLOT_HAS_ACTIVE_ASSIGNMENT"
            );

        const updated = await ParkingSlot.findOneAndUpdate(
            { _id: slotId, societyId },
            { $set: { isActive: false, status: PARKING_STATUS.INACTIVE, updatedBy: userId }, $inc: { version: 1 } },
            { new: true }
        );
        return updated;
    },

    // ── Dashboard Stats ────────────────────────────────────────────────────────

    async getDashboardStats({ societyId }) {
        const db = getOperationsConnection();
        const ParkingSlot = db.model("ParkingSlot");
        const Vehicle = db.model("Vehicle");
        const VisitorParking = db.model("VisitorParking");
        const ParkingAssignment = db.model("ParkingAssignment");

        const mongoose = require("mongoose");
        const socObjId = mongoose.Types.ObjectId.isValid(societyId) ? new mongoose.Types.ObjectId(String(societyId)) : societyId;

        const [slotStats, vehicleCount, activeVisitors, activeAssignments] = await Promise.all([
            ParkingSlot.aggregate([
                { $match: { societyId: socObjId } },
                { $group: { _id: "$status", count: { $sum: 1 } } },
            ]),
            Vehicle.countDocuments({ societyId, isActive: true }),
            VisitorParking.countDocuments({ societyId, status: VISITOR_PARKING_STATUS.ACTIVE }),
            ParkingAssignment.countDocuments({ societyId, status: PARKING_ASSIGNMENT_STATUS.ACTIVE }),
        ]);

        const byStatus = {};
        let total = 0;
        for (const entry of slotStats) {
            byStatus[entry._id] = entry.count;
            total += entry.count;
        }

        return {
            totalSlots: total,
            available:   byStatus[PARKING_STATUS.AVAILABLE]   || 0,
            allocated:   byStatus[PARKING_STATUS.ALLOCATED]   || 0,
            occupied:    byStatus[PARKING_STATUS.OCCUPIED]    || 0, // legacy
            reserved:    byStatus[PARKING_STATUS.RESERVED]    || 0,
            maintenance: byStatus[PARKING_STATUS.MAINTENANCE] || 0,
            inactive:    byStatus[PARKING_STATUS.INACTIVE]    || 0,
            totalVehicles: vehicleCount,
            activeVisitorSessions: activeVisitors,
            activeAssignments,
        };
    },

    // ══════════════════════════════════════════════════════════════════════════
    // ── VEHICLE SERVICE ───────────────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════════

    async registerVehicle({ societyId, requestingUserId, requestingUserRole, body }) {
        const db = getOperationsConnection();
        const Vehicle = db.model("Vehicle");

        let { userId, flatId, regNumber, type, make, model, color } = body;

        // Residents can only register vehicles for themselves
        if (isResidentRole(requestingUserRole)) {
            userId = requestingUserId;
        }

        // Normalize registration number
        regNumber = normalizeRegNumber(regNumber);
        if (!regNumber) throw new AppError("Vehicle registration number is required.", 400, "VEHICLE_NOT_FOUND");

        // Validate resident context
        const resident = await getResidentContextOrThrow(db, userId, societyId);
        if (flatId) {
            const flat = await getFlatOrThrow(db, flatId, societyId);
            assertResidentInFlat(resident, flat._id);
        } else {
            flatId = resident.flatId;
        }

        try {
            const vehicle = await Vehicle.create({
                societyId,
                userId,
                residentId: resident._id,
                flatId,
                regNumber,
                type,
                make,
                model,
                color,
                isActive: true,
                createdBy: requestingUserId,
                updatedBy: requestingUserId,
            });
            return vehicle;
        } catch (err) {
            if (err.code === 11000)
                throw new AppError(`Vehicle "${regNumber}" is already registered in this society.`, 409, "VEHICLE_ALREADY_REGISTERED");
            throw err;
        }
    },

    async listVehicles({ societyId, requestingUserId, requestingUserRole, query }) {
        const db = getOperationsConnection();
        const Vehicle = db.model("Vehicle");
        const { page, limit, skip } = getPaginationOptions(query);

        const filter = { societyId, isActive: true };

        // Residents only see their own vehicles
        if (isResidentRole(requestingUserRole)) {
            filter.userId = requestingUserId;
        } else {
            if (query.userId)  filter.userId  = query.userId;
            if (query.flatId)  filter.flatId  = query.flatId;
            if (query.type)    filter.type    = query.type;
            if (query.search)  filter.regNumber = { $regex: normalizeRegNumber(query.search), $options: "i" };
            if (query.isActive !== undefined) {
                filter.isActive = query.isActive === "true";
                delete filter.isActive; // handled below
                filter.isActive = query.isActive !== "false";
            }
        }

        const [vehicles, total] = await Promise.all([
            Vehicle.find(filter)
                .populate("userId", "name email mobile")
                .populate({ path: "flatId", select: "flatNumber floor blockId", populate: { path: "blockId", select: "wings" } })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Vehicle.countDocuments(filter),
        ]);

        // Inject wingName and clean flatNumber derived from block wings or flatNumber prefix
        const enriched = vehicles.map((v) => {
            const flat = v.flatId;
            if (!flat) return v;

            const flatNum = flat.flatNumber || "";
            const block = flat.blockId;
            let wingName = null;

            if (block && Array.isArray(block.wings) && block.wings.length > 0) {
                // Try to match flatNumber prefix against wing codes (e.g. "A-102" matches wing code "A")
                const dashIdx = flatNum.indexOf("-");
                const prefix = dashIdx > -1 ? flatNum.substring(0, dashIdx).trim().toUpperCase() : null;
                if (prefix) {
                    const matched = block.wings.find(
                        (w) => (w.code || "").toUpperCase() === prefix || (w.name || "").toUpperCase() === prefix
                    );
                    wingName = matched ? (matched.name || matched.code) : prefix;
                }
            }

            // If wingName not found from block, try to parse from flatNumber directly
            if (!wingName) {
                const dashIdx = flatNum.indexOf("-");
                if (dashIdx > -1) wingName = flatNum.substring(0, dashIdx).trim();
            }

            return {
                ...v,
                flatId: {
                    ...flat,
                    wingName: wingName || null,
                    // Pure flat number without wing prefix for clean display
                    flatNumberClean: flatNum.includes("-")
                        ? flatNum.substring(flatNum.indexOf("-") + 1).trim()
                        : flatNum,
                },
            };
        });

        return { vehicles: enriched, meta: buildPaginationMeta(total, page, limit) };
    },

    async getVehicleById({ vehicleId, societyId, requestingUserId, requestingUserRole }) {
        const db = getOperationsConnection();
        const filter = { _id: vehicleId, societyId };
        if (isResidentRole(requestingUserRole)) filter.userId = requestingUserId;

        const vehicle = await db.model("Vehicle").findOne(filter)
            .populate("userId", "name email mobile")
            .populate("flatId", "flatNumber floor")
            .lean();
        if (!vehicle) throw new AppError("Vehicle not found.", 404, "VEHICLE_NOT_FOUND");
        return vehicle;
    },

    async updateVehicle({ vehicleId, societyId, requestingUserId, requestingUserRole, body }) {
        const db = getOperationsConnection();
        const Vehicle = db.model("Vehicle");

        const filter = { _id: vehicleId, societyId, isActive: true };
        // Residents can only update their own vehicles
        if (isResidentRole(requestingUserRole)) filter.userId = requestingUserId;

        const allowedUpdates = ["make", "model", "color", "type"];
        const updates = { updatedBy: requestingUserId };
        for (const key of allowedUpdates) {
            if (body[key] !== undefined) updates[key] = body[key];
        }

        const updated = await Vehicle.findOneAndUpdate(
            filter,
            { $set: updates },
            { new: true, runValidators: true }
        );
        if (!updated) throw new AppError("Vehicle not found.", 404, "VEHICLE_NOT_FOUND");
        return updated;
    },

    async deactivateVehicle({ vehicleId, societyId, requestingUserId, requestingUserRole }) {
        const db = getOperationsConnection();
        const Vehicle = db.model("Vehicle");
        const ParkingAssignment = db.model("ParkingAssignment");

        const filter = { _id: vehicleId, societyId, isActive: true };
        if (isResidentRole(requestingUserRole)) filter.userId = requestingUserId;

        const vehicle = await Vehicle.findOne(filter).lean();
        if (!vehicle) throw new AppError("Vehicle not found.", 404, "VEHICLE_NOT_FOUND");

        // Cannot deactivate vehicle with active parking assignment
        const activeAssignment = await ParkingAssignment.findOne({
            vehicleId,
            status: PARKING_ASSIGNMENT_STATUS.ACTIVE,
        }).lean();

        if (activeAssignment)
            throw new AppError(
                "Cannot deactivate vehicle: it has an active parking assignment. Release the assignment first.",
                409,
                "VEHICLE_ALREADY_ASSIGNED"
            );

        await Vehicle.updateOne({ _id: vehicleId }, { $set: { isActive: false, updatedBy: requestingUserId } });
        return { message: "Vehicle deactivated successfully." };
    },

    // ══════════════════════════════════════════════════════════════════════════
    // ── PARKING ASSIGNMENT SERVICE ────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════════

    async allocateParking({ societyId, assignedByUserId, body }) {
        const db = getOperationsConnection();
        const ParkingSlot = db.model("ParkingSlot");
        const ParkingAssignment = db.model("ParkingAssignment");

        const { slotId, userId, vehicleId, assignmentType, startDate, endDate, notes } = body;
        let { flatId } = body;

        // 1. Validate slot
        const slot = await getSlotOrThrow(db, slotId, societyId);
        assertSlotAvailable(slot);

        // 2. Validate resident first, then derive flatId if not supplied
        const resident = await getResidentContextOrThrow(db, userId, societyId);
        if (!flatId) flatId = resident.flatId;

        // 3. Validate flat & assert resident belongs to it
        const flat = await getFlatOrThrow(db, flatId, societyId);
        assertResidentInFlat(resident, flat._id);

        // 4. Validate vehicle
        const vehicle = await getVehicleOrThrow(db, vehicleId, societyId);
        if (String(vehicle.userId) !== String(userId))
            throw new AppError("Vehicle does not belong to the specified resident.", 400, "INVALID_VEHICLE_TYPE");

        // 5. Validate date range for TEMPORARY assignments
        if (assignmentType === PARKING_ASSIGNMENT_TYPE.TEMPORARY) {
            if (!startDate || !endDate)
                throw new AppError("Start date and end date are required for temporary assignments.", 400, "PARKING_CONFLICT");
            if (new Date(startDate) >= new Date(endDate))
                throw new AppError("Start date must be before end date.", 400, "PARKING_CONFLICT");

            // Check for time-overlap with any other active/temporary assignment on the same slot
            const overlap = await ParkingAssignment.findOne({
                parkingSlotId: slotId,
                status: PARKING_ASSIGNMENT_STATUS.ACTIVE,
                $or: [
                    { endDate: { $gt: new Date(startDate) }, startDate: { $lt: new Date(endDate) } },
                    { endDate: null }, // permanent assignment blocks
                ],
            }).lean();
            if (overlap)
                throw new AppError("The slot has a conflicting assignment in the requested time range.", 409, "PARKING_CONFLICT");
        }

        // 5. Atomic: update slot status first
        const updatedSlot = await ParkingSlot.findOneAndUpdate(
            { _id: slotId, societyId, status: PARKING_STATUS.AVAILABLE, isActive: true },
            { $set: { status: PARKING_STATUS.ALLOCATED, updatedBy: assignedByUserId }, $inc: { version: 1 } },
            { new: true }
        );

        if (!updatedSlot)
            throw new AppError("Parking slot is no longer available.", 409, "PARKING_SLOT_NOT_AVAILABLE");

        // 6. Create assignment — partial unique index guards against concurrent duplicates
        try {
            const assignment = await ParkingAssignment.create({
                societyId,
                parkingSlotId: slotId,
                residentId: resident._id,
                userId,
                flatId,
                vehicleId,
                assignmentType: assignmentType || PARKING_ASSIGNMENT_TYPE.PERMANENT,
                status: PARKING_ASSIGNMENT_STATUS.ACTIVE,
                startDate: startDate || new Date(),
                endDate: endDate || null,
                assignedBy: assignedByUserId,
                notes,
            });
            return { assignment, slot: updatedSlot };
        } catch (err) {
            // Rollback slot status on assignment failure
            await ParkingSlot.updateOne(
                { _id: slotId },
                { $set: { status: PARKING_STATUS.AVAILABLE }, $inc: { version: 1 } }
            );
            if (err.code === 11000)
                throw new AppError("Parking slot was allocated by another request. Please try again.", 409, "PARKING_ALREADY_ALLOCATED");
            throw err;
        }
    },

    async listAssignments({ societyId, requestingUserId, requestingUserRole, query }) {
        const db = getOperationsConnection();
        const ParkingAssignment = db.model("ParkingAssignment");
        const { page, limit, skip } = getPaginationOptions(query);

        const filter = { societyId };
        if (isResidentRole(requestingUserRole)) {
            filter.userId = requestingUserId;
        } else {
            if (query.status)   filter.status   = query.status;
            if (query.flatId)   filter.flatId   = query.flatId;
            if (query.userId)   filter.userId   = query.userId;
            if (query.slotId)   filter.parkingSlotId = query.slotId;
        }

        const [assignments, total] = await Promise.all([
            ParkingAssignment.find(filter)
                .populate("parkingSlotId", "slotNumber type floor wing status")
                .populate("userId", "name email mobile")
                .populate("flatId", "flatNumber floor wing")
                .populate("vehicleId", "regNumber type make model color")
                .populate("assignedBy", "name")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            ParkingAssignment.countDocuments(filter),
        ]);

        return { assignments, meta: buildPaginationMeta(total, page, limit) };
    },

    async getAssignmentById({ assignmentId, societyId, requestingUserId, requestingUserRole }) {
        const db = getOperationsConnection();
        const filter = { _id: assignmentId, societyId };
        if (isResidentRole(requestingUserRole)) filter.userId = requestingUserId;

        const assignment = await db.model("ParkingAssignment").findOne(filter)
            .populate("parkingSlotId", "slotNumber type floor wing status")
            .populate("userId", "name email mobile")
            .populate("flatId", "flatNumber floor")
            .populate("vehicleId", "regNumber type make model color")
            .lean();

        if (!assignment) throw new AppError("Parking assignment not found.", 404, "PARKING_ASSIGNMENT_NOT_FOUND");
        return assignment;
    },

    async releaseParking({ assignmentId, societyId, releasedByUserId, body }) {
        const db = getOperationsConnection();
        const ParkingSlot = db.model("ParkingSlot");
        const ParkingAssignment = db.model("ParkingAssignment");

        const { releaseReason } = body || {};

        const assignment = await ParkingAssignment.findOne({
            _id: assignmentId,
            societyId,
            status: PARKING_ASSIGNMENT_STATUS.ACTIVE,
        });

        if (!assignment)
            throw new AppError("Active parking assignment not found.", 404, "PARKING_ASSIGNMENT_NOT_FOUND");

        const now = new Date();

        // Update assignment status
        assignment.status = PARKING_ASSIGNMENT_STATUS.RELEASED;
        assignment.releasedBy = releasedByUserId;
        assignment.releasedAt = now;
        assignment.releaseReason = releaseReason || null;
        await assignment.save();

        // Make slot available again
        await ParkingSlot.updateOne(
            { _id: assignment.parkingSlotId },
            { $set: { status: PARKING_STATUS.AVAILABLE, updatedBy: releasedByUserId }, $inc: { version: 1 } }
        );

        return assignment;
    },

    async reassignParking({ assignmentId, societyId, reassignedByUserId, body }) {
        const db = getOperationsConnection();

        // Release existing
        const released = await ParkingService.releaseParking({
            assignmentId,
            societyId,
            releasedByUserId: reassignedByUserId,
            body: { releaseReason: "Reassigned to new resident" },
        });

        // Allocate to new resident
        const newAssignment = await ParkingService.allocateParking({
            societyId,
            assignedByUserId: reassignedByUserId,
            body: {
                slotId: released.parkingSlotId,
                ...body,
            },
        });

        newAssignment.assignment.transferredFrom = assignmentId;
        await newAssignment.assignment.save();

        return { released, newAssignment: newAssignment.assignment };
    },

    // ══════════════════════════════════════════════════════════════════════════
    // ── PARKING REQUESTS SERVICE ──────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════════

    async createRequest({ societyId, requestingUserId, body }) {
        const db = getOperationsConnection();
        const ParkingRequest = db.model("ParkingRequest");

        const { vehicleId, requestedSlotType, notes } = body;

        const resident = await getResidentContextOrThrow(db, requestingUserId, societyId);

        if (vehicleId) {
            await getVehicleOrThrow(db, vehicleId, societyId);
        }

        const request = await ParkingRequest.create({
            societyId,
            userId: requestingUserId,
            residentId: resident._id,
            flatId: resident.flatId,
            vehicleId: vehicleId || null,
            requestedSlotType: requestedSlotType || null,
            notes,
            status: PARKING_REQUEST_STATUS.PENDING,
        });

        return request;
    },

    async listRequests({ societyId, requestingUserId, requestingUserRole, query }) {
        const db = getOperationsConnection();
        const ParkingRequest = db.model("ParkingRequest");
        const { page, limit, skip } = getPaginationOptions(query);

        const filter = { societyId };
        if (isResidentRole(requestingUserRole)) {
            filter.userId = requestingUserId;
        } else {
            if (query.status) filter.status = query.status;
        }

        const [requests, total] = await Promise.all([
            ParkingRequest.find(filter)
                .populate("residentId")
                .populate("userId", "name email mobile")
                .populate({
                    path: "flatId",
                    select: "flatNumber floor blockId wing",
                    populate: { path: "blockId", select: "name wingName" },
                })
                .populate("vehicleId", "regNumber type")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            ParkingRequest.countDocuments(filter),
        ]);

        const formattedRequests = requests.map((req) => {
            const wingName = req.flatId?.wing || req.flatId?.blockId?.wingName || req.flatId?.blockId?.name || "";
            return {
                ...req,
                flatId: req.flatId ? { ...req.flatId, wing: wingName } : null,
                residentId: req.residentId ? {
                    ...req.residentId,
                    name: req.residentId.name || req.userId?.name || "Resident",
                    email: req.residentId.email || req.userId?.email || "",
                } : (req.userId ? { name: req.userId.name, email: req.userId.email } : null),
            };
        });

        return { requests: formattedRequests, meta: buildPaginationMeta(total, page, limit) };
    },

    async approveRequest({ requestId, societyId, reviewedByUserId, body }) {
        const db = getOperationsConnection();
        const ParkingRequest = db.model("ParkingRequest");

        const request = await ParkingRequest.findOne({
            _id: requestId,
            societyId,
            status: PARKING_REQUEST_STATUS.PENDING,
        });

        if (!request)
            throw new AppError("Pending parking request not found.", 404, "PARKING_REQUEST_NOT_FOUND");

        const { slotId, notes } = body;

        // Allocate parking (this handles all validation + concurrency)
        const { assignment } = await ParkingService.allocateParking({
            societyId,
            assignedByUserId: reviewedByUserId,
            body: {
                slotId,
                userId: request.userId,
                flatId: request.flatId,
                vehicleId: request.vehicleId,
                assignmentType: PARKING_ASSIGNMENT_TYPE.PERMANENT,
                notes,
            },
        });

        // Update request status atomically — prevents double-approval
        const updated = await ParkingRequest.findOneAndUpdate(
            { _id: requestId, status: PARKING_REQUEST_STATUS.PENDING },
            {
                $set: {
                    status: PARKING_REQUEST_STATUS.APPROVED,
                    reviewedBy: reviewedByUserId,
                    reviewedAt: new Date(),
                    assignmentId: assignment._id,
                },
            },
            { new: true }
        );

        if (!updated) {
            // Another admin approved concurrently — rollback the assignment we just created
            await ParkingService.releaseParking({
                assignmentId: assignment._id,
                societyId,
                releasedByUserId: reviewedByUserId,
                body: { releaseReason: "Concurrent approval race condition rollback" },
            });
            throw new AppError("Request was already processed by another admin.", 409, "PARKING_REQUEST_ALREADY_PROCESSED");
        }

        return updated;
    },

    async rejectRequest({ requestId, societyId, reviewedByUserId, body }) {
        const db = getOperationsConnection();
        const ParkingRequest = db.model("ParkingRequest");

        const updated = await ParkingRequest.findOneAndUpdate(
            { _id: requestId, societyId, status: PARKING_REQUEST_STATUS.PENDING },
            {
                $set: {
                    status: PARKING_REQUEST_STATUS.REJECTED,
                    reviewedBy: reviewedByUserId,
                    reviewedAt: new Date(),
                    rejectionReason: body.rejectionReason || null,
                },
            },
            { new: true }
        );

        if (!updated)
            throw new AppError("Pending parking request not found.", 404, "PARKING_REQUEST_NOT_FOUND");

        return updated;
    },

    // ══════════════════════════════════════════════════════════════════════════
    // ── VISITOR PARKING SERVICE ───────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════════

    async createVisitorSession({ societyId, recordedByUserId, body }) {
        const db = getOperationsConnection();
        const ParkingSlot = db.model("ParkingSlot");
        const VisitorParking = db.model("VisitorParking");

        const { slotId, visitorName, vehicleNumber, vehicleType, hostFlatId, expectedExitTime, notes } = body;

        const slot = await getSlotOrThrow(db, slotId, societyId);

        // Visitor parking slots only
        if (slot.type !== PARKING_TYPE.VISITOR)
            throw new AppError(
                "Visitor parking can only be assigned to slots of type VISITOR.",
                409,
                "VISITOR_PARKING_CONFLICT"
            );

        if (!slot.isActive || slot.status === PARKING_STATUS.INACTIVE)
            throw new AppError("Slot is inactive.", 409, "PARKING_SLOT_INACTIVE");

        if (slot.status !== PARKING_STATUS.AVAILABLE)
            throw new AppError("Visitor slot is not available.", 409, "VISITOR_PARKING_CONFLICT");

        // Validate host flat
        if (hostFlatId) await getFlatOrThrow(db, hostFlatId, societyId);

        // Atomically mark slot as allocated
        const updatedSlot = await ParkingSlot.findOneAndUpdate(
            { _id: slotId, societyId, status: PARKING_STATUS.AVAILABLE, isActive: true },
            { $set: { status: PARKING_STATUS.ALLOCATED, updatedBy: recordedByUserId }, $inc: { version: 1 } },
            { new: true }
        );
        if (!updatedSlot)
            throw new AppError("Visitor slot is no longer available.", 409, "VISITOR_PARKING_CONFLICT");

        try {
            const session = await VisitorParking.create({
                societyId,
                parkingSlotId: slotId,
                visitorName,
                vehicleNumber: normalizeRegNumber(vehicleNumber),
                vehicleType,
                hostFlatId: hostFlatId || null,
                entryTime: new Date(),
                expectedExitTime: expectedExitTime || null,
                status: VISITOR_PARKING_STATUS.ACTIVE,
                recordedBy: recordedByUserId,
                notes,
            });
            return session;
        } catch (err) {
            // Rollback slot
            await ParkingSlot.updateOne(
                { _id: slotId },
                { $set: { status: PARKING_STATUS.AVAILABLE }, $inc: { version: 1 } }
            );
            if (err.code === 11000)
                throw new AppError("Visitor slot already has an active session.", 409, "VISITOR_PARKING_CONFLICT");
            throw err;
        }
    },

    async listVisitorSessions({ societyId, query }) {
        const db = getOperationsConnection();
        const VisitorParking = db.model("VisitorParking");
        const { page, limit, skip } = getPaginationOptions(query);

        const filter = { societyId };
        if (query.status)     filter.status     = query.status;
        if (query.hostFlatId) filter.hostFlatId = query.hostFlatId;

        const [sessions, total] = await Promise.all([
            VisitorParking.find(filter)
                .populate("parkingSlotId", "slotNumber wing floor")
                .populate("hostFlatId", "flatNumber floor")
                .sort({ entryTime: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            VisitorParking.countDocuments(filter),
        ]);

        return { sessions, meta: buildPaginationMeta(total, page, limit) };
    },

    async exitVisitor({ sessionId, societyId, exitRecordedByUserId }) {
        const db = getOperationsConnection();
        const ParkingSlot = db.model("ParkingSlot");
        const VisitorParking = db.model("VisitorParking");

        const session = await VisitorParking.findOne({
            _id: sessionId,
            societyId,
            status: VISITOR_PARKING_STATUS.ACTIVE,
        });

        if (!session)
            throw new AppError("Active visitor parking session not found.", 404, "VISITOR_SESSION_EXPIRED");

        session.status = VISITOR_PARKING_STATUS.COMPLETED;
        session.actualExitTime = new Date();
        session.exitRecordedBy = exitRecordedByUserId;
        await session.save();

        await ParkingSlot.updateOne(
            { _id: session.parkingSlotId },
            { $set: { status: PARKING_STATUS.AVAILABLE, updatedBy: exitRecordedByUserId }, $inc: { version: 1 } }
        );

        return session;
    },

    // ══════════════════════════════════════════════════════════════════════════
    // ── VIOLATIONS SERVICE ────────────────────────────────════════════════════
    // ══════════════════════════════════════════════════════════════════════════

    async createViolation({ societyId, reportedByUserId, body, files }) {
        const db = getOperationsConnection();
        const ParkingViolation = db.model("ParkingViolation");

        const {
            parkingSlotId, vehicleId, residentId,
            unregisteredVehicleNumber, violationType, description,
        } = body;

        const evidence = files ? files.map((f) => `/uploads/${f.filename}`) : [];

        const violation = await ParkingViolation.create({
            societyId,
            parkingSlotId: parkingSlotId || null,
            vehicleId: vehicleId || null,
            residentId: residentId || null,
            unregisteredVehicleNumber: unregisteredVehicleNumber
                ? normalizeRegNumber(unregisteredVehicleNumber)
                : null,
            violationType,
            description,
            evidence,
            reportedBy: reportedByUserId,
        });

        return violation;
    },

    async listViolations({ societyId, query }) {
        const db = getOperationsConnection();
        const ParkingViolation = db.model("ParkingViolation");
        const { page, limit, skip } = getPaginationOptions(query);

        const filter = { societyId };
        if (query.status)       filter.status       = query.status;
        if (query.violationType) filter.violationType = query.violationType;

        const [violations, total] = await Promise.all([
            ParkingViolation.find(filter)
                .populate("parkingSlotId", "slotNumber wing floor")
                .populate("vehicleId", "regNumber type")
                .populate("residentId")
                .populate("reportedBy", "name")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            ParkingViolation.countDocuments(filter),
        ]);

        return { violations, meta: buildPaginationMeta(total, page, limit) };
    },

    // ── Parking History (all assignment events) ────────────────────────────────

    async getHistory({ societyId, requestingUserId, requestingUserRole, query }) {
        const db = getOperationsConnection();
        const ParkingAssignment = db.model("ParkingAssignment");
        const { page, limit, skip } = getPaginationOptions(query);

        const filter = { societyId };
        if (isResidentRole(requestingUserRole)) {
            filter.userId = requestingUserId;
        } else {
            if (query.status)  filter.status  = query.status;
            if (query.flatId)  filter.flatId  = query.flatId;
            if (query.slotId)  filter.parkingSlotId = query.slotId;
        }

        const [history, total] = await Promise.all([
            ParkingAssignment.find(filter)
                .populate("parkingSlotId", "slotNumber type wing floor")
                .populate("userId", "name")
                .populate("flatId", "flatNumber")
                .populate("vehicleId", "regNumber type")
                .populate("assignedBy", "name")
                .populate("releasedBy", "name")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            ParkingAssignment.countDocuments(filter),
        ]);

        return { history, meta: buildPaginationMeta(total, page, limit) };
    },
};

module.exports = ParkingService;
