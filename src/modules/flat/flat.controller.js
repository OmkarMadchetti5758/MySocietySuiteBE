"use strict";

const mongoose = require("mongoose");
const { getOperationsConnection } = require("../../config/operationsDb");
const { sendSuccess, sendError } = require("../../utils/response.utils");
const { FLAT_STATUS } = require("../../common/constants");



/**
 * Helper to match wings by code or name prefix e.g. "A-101" -> Wing A
 */
function findWingByFlatNumber(wings, flatNumber) {
    const trimmed = String(flatNumber || "").trim();
    if (!trimmed || !Array.isArray(wings)) return null;

    for (const w of wings) {
        const wingLetter = (w.code || (w.name || "").trim().split(" ")[0] || "").trim();
        if (wingLetter) {
            const escaped = wingLetter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            if (new RegExp(`^${escaped}[-_\\s]?\\d+`, "i").test(trimmed)) {
                return w;
            }
        }
    }
    return null;
}

/**
 * Helper to resolve a wing within a Block document.
 */
function findWingInBlock(blockDoc, blockId, flatNumber) {
    if (!blockDoc || !Array.isArray(blockDoc.wings) || blockDoc.wings.length === 0) {
        return null;
    }

    if (blockId) {
        const wingById = blockDoc.wings.find((w) => String(w._id) === String(blockId));
        if (wingById) return wingById;

        if (String(blockDoc._id) === String(blockId)) {
            if (blockDoc.wings.length === 1) return blockDoc.wings[0];
            if (flatNumber) {
                const wingByNumber = findWingByFlatNumber(blockDoc.wings, flatNumber);
                if (wingByNumber) return wingByNumber;
            }
        }
    }

    if (flatNumber) {
        const wingByNumber = findWingByFlatNumber(blockDoc.wings, flatNumber);
        if (wingByNumber) return wingByNumber;
    }

    return null;
}

/**
 * Helper to build MongoDB query conditions for matching flats belonging to a specific wing,
 * supporting both direct wing._id and legacy blockDoc._id + flatNumber prefix.
 */
function buildWingMatchConditions(wing, blockDoc) {
    const conditions = [{ blockId: wing._id }];
    if (blockDoc?._id) {
        if (blockDoc.wings && blockDoc.wings.length === 1) {
            conditions.push({ blockId: blockDoc._id });
        } else {
            const wingCode = (wing.code || (wing.name || "").trim().split(" ")[0] || "").trim();
            if (wingCode) {
                const escaped = wingCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                conditions.push({
                    blockId: blockDoc._id,
                    flatNumber: { $regex: new RegExp(`^${escaped}[-_\\s]?`, "i") },
                });
            }
        }
    }
    return conditions;
}

/**
 * Helper to compute effective max units per floor with safe fallbacks.
 */
function getEffectiveUnitsPerFloor(wing) {
    const configured = Number(wing.unitsPerFloor);
    if (Number.isInteger(configured) && configured > 0) {
        return configured;
    }
    const totalFloors = Number(wing.totalFloors) || 0;
    const unitCount = Number(wing.unitCount || wing.totalFlats) || 0;
    if (totalFloors > 0 && unitCount > 0) {
        return Math.ceil(unitCount / totalFloors);
    }
    return 4;
}

class FlatController {
    async getFlats(req, res, next) {
        try {
            const { blockId } = req.query;
            const operationsDb = getOperationsConnection();
            const Flat = operationsDb.model("Flat");
            const Resident = operationsDb.model("Resident");
            const Block = operationsDb.model("Block");

            const blockDoc = await Block.findOne({ societyId: req.user.societyId }).lean();
            const filter = { societyId: req.user.societyId };
            if (blockId) {
                const wing = blockDoc?.wings?.find((w) => String(w._id) === String(blockId));
                if (wing) {
                    filter.$or = buildWingMatchConditions(wing, blockDoc);
                } else {
                    filter.blockId = blockId;
                }
            }

            let flats = await Flat.find(filter)
                .populate("primaryOwner", "name fullName email phone mobile")
                .sort({ floor: 1, flatNumber: 1 })
                .lean();

            const activeResidents = await Resident.find({
                societyId: req.user.societyId,
                isActive: true,
            }).select("flatId").lean();

            const occupiedFlatIds = new Set(
                activeResidents.map((r) => String(r.flatId)).filter(Boolean)
            );

            const mismatched = flats.filter(
                (flat) =>
                    occupiedFlatIds.has(String(flat._id)) &&
                    (flat.occupancyStatus === "Vacant" || flat.status === FLAT_STATUS.VACANT)
            );

            if (mismatched.length > 0) {
                const ResidentRepository = require("../resident/resident.repository");
                await Promise.all(
                    mismatched.map((flat) =>
                        ResidentRepository.syncFlatOccupancy(req.user.societyId, flat._id)
                    )
                );
                flats = await Flat.find(filter)
                    .populate("primaryOwner", "name fullName email phone mobile")
                    .sort({ floor: 1, flatNumber: 1 })
                    .lean();
            }

            const wingMap = new Map();
            if (blockDoc?.wings) {
                for (const wing of blockDoc.wings) {
                    wingMap.set(String(wing._id), { _id: wing._id, name: wing.name, code: wing.code });
                }
            }

            const populatedFlats = flats.map((flat) => {
                const ownerName = flat.ownerName || flat.primaryOwner?.name || flat.primaryOwner?.fullName || '';
                let resolvedWing = wingMap.get(String(flat.blockId));
                if (!resolvedWing && blockDoc?.wings) {
                    const matchedWing = findWingByFlatNumber(blockDoc.wings, flat.flatNumber);
                    if (matchedWing) {
                        resolvedWing = { _id: matchedWing._id, name: matchedWing.name, code: matchedWing.code };
                    }
                }
                return {
                    ...flat,
                    ownerName: ownerName || flat.ownerName || '',
                    blockId: resolvedWing || flat.blockId,
                };
            });

            return sendSuccess(res, 200, "Flats retrieved successfully", { flats: populatedFlats });
        } catch (error) {
            next(error);
        }
    }

    async createFlat(req, res, next) {
        try {
            const operationsDb = getOperationsConnection();
            const Flat = operationsDb.model("Flat");
            const Block = operationsDb.model("Block");

            const {
                blockId,
                floor,
                flatNumber,
                type,
                area,
                ownershipType,
                occupancyStatus,
                primaryOwner,
                activeTenant,
                numberOfResidents,
                parkingSlots,
                possessionDate,
                status
            } = req.body;

            // 1. Validate wing selection
            if (!blockId) {
                return sendError(res, 400, "Wing selection (blockId) is required.");
            }

            const trimmedFlatNumber = String(flatNumber || "").trim();
            if (!trimmedFlatNumber) {
                return sendError(res, 400, "Flat number is required.");
            }

            // 2. Validate that the selected wing belongs to the authenticated user's society
            const blockDoc = await Block.findOne({ societyId: req.user.societyId });
            if (!blockDoc) {
                return sendError(res, 400, "Society block configuration not found.");
            }

            const wing = findWingInBlock(blockDoc, blockId, trimmedFlatNumber);
            if (!wing) {
                return sendError(res, 400, "Selected wing was not found or does not belong to this society.");
            }

            // 3. Validate floor: must be a positive integer between 1 and configured totalFloors
            if (floor === undefined || floor === null || String(floor).trim() === "") {
                return sendError(res, 400, "Floor number is required.");
            }
            const floorNum = Number(floor);
            if (!Number.isInteger(floorNum) || floorNum < 1) {
                return sendError(res, 400, "Floor must be a positive integer.");
            }

            const totalFloors = Number(wing.totalFloors) || 0;
            if (totalFloors <= 0) {
                return sendError(res, 400, `Wing ${wing.name} does not have a valid total floors configuration.`);
            }
            if (floorNum > totalFloors) {
                return sendError(res, 400, `Floor ${floorNum} is invalid. Wing ${wing.name} has only ${totalFloors} floor(s).`);
            }

            // 4. Preserve existing duplicate flat-number validation
            const wingMatchConditions = buildWingMatchConditions(wing, blockDoc);
            const existing = await Flat.findOne({
                societyId: req.user.societyId,
                flatNumber: trimmedFlatNumber,
                $or: wingMatchConditions,
            });
            if (existing) {
                return sendError(res, 400, "A flat with this number already exists in this wing.");
            }

            // 5. Enforce unitsPerFloor capacity on the selected wing and floor
            const effectiveMaxUnits = getEffectiveUnitsPerFloor(wing);
            const existingFloorCount = await Flat.countDocuments({
                societyId: req.user.societyId,
                floor: floorNum,
                $or: wingMatchConditions,
            });

            if (existingFloorCount >= effectiveMaxUnits) {
                return sendError(
                    res,
                    400,
                    `Floor ${floorNum} of Wing ${wing.name} has reached its maximum capacity of ${effectiveMaxUnits} unit(s).`
                );
            }

            // 6. Save new flat
            const targetBlockId = wing._id || blockId;
            const newFlat = new Flat({
                societyId: req.user.societyId,
                blockId: targetBlockId,
                floor: floorNum,
                flatNumber: trimmedFlatNumber,
                type,
                area,
                ownershipType,
                occupancyStatus: occupancyStatus || "Vacant",
                primaryOwner,
                activeTenant,
                numberOfResidents: numberOfResidents || 0,
                parkingSlots: parkingSlots || 0,
                possessionDate,
                status: status || FLAT_STATUS.VACANT
            });

            await newFlat.save();

            return sendSuccess(res, 201, "Flat created successfully", { flat: newFlat });
        } catch (error) {
            if (error.code === 11000) {
                error.message = "A flat with this number already exists in this wing.";
                error.statusCode = 400;
            }
            next(error);
        }
    }

    async getFlatById(req, res, next) {
        try {
            const { flatId } = req.params;
            const operationsDb = getOperationsConnection();
            const Flat = operationsDb.model("Flat");

            const flat = await Flat.findOne({ _id: flatId, societyId: req.user.societyId });
            if (!flat) {
                return sendError(res, 404, "Flat not found");
            }

            return sendSuccess(res, 200, "Flat retrieved successfully", { flat });
        } catch (error) {
            next(error);
        }
    }

    async updateFlat(req, res, next) {
        try {
            const { flatId } = req.params;
            const operationsDb = getOperationsConnection();
            const Flat = operationsDb.model("Flat");
            const Block = operationsDb.model("Block");

            // 1. Find existing flat in society
            const flat = await Flat.findOne({ _id: flatId, societyId: req.user.societyId });
            if (!flat) {
                return sendError(res, 404, "Flat not found or could not be updated");
            }

            // 2. Load Block configuration for society
            const blockDoc = await Block.findOne({ societyId: req.user.societyId });
            const wing = findWingInBlock(blockDoc, flat.blockId, flat.flatNumber);

            const allowedUpdates = [
                "floor", "flatNumber", "type", "area", "ownershipType", 
                "occupancyStatus", "primaryOwner", "activeTenant", 
                "numberOfResidents", "parkingSlots", "possessionDate", 
                "status", "ownerName", "ownerContact", "isActive"
            ];
            
            const updates = {};
            for (const key of allowedUpdates) {
                if (req.body[key] !== undefined) {
                    updates[key] = req.body[key];
                }
            }

            // 3. Validate floor change if requested
            if (updates.floor !== undefined) {
                const targetFloor = Number(updates.floor);
                if (!Number.isInteger(targetFloor) || targetFloor < 1) {
                    return sendError(res, 400, "Floor must be a positive integer.");
                }

                if (!wing) {
                    return sendError(res, 400, "Wing configuration for this flat was not found.");
                }

                const totalFloors = Number(wing.totalFloors) || 0;
                if (totalFloors <= 0) {
                    return sendError(res, 400, `Wing ${wing.name} does not have a valid total floors configuration.`);
                }
                if (targetFloor > totalFloors) {
                    return sendError(res, 400, `Floor ${targetFloor} is invalid. Wing ${wing.name} has only ${totalFloors} floor(s).`);
                }

                // If moving to a different floor, validate capacity on the destination floor
                if (targetFloor !== flat.floor) {
                    const effectiveMaxUnits = getEffectiveUnitsPerFloor(wing);
                    const wingMatchConditions = buildWingMatchConditions(wing, blockDoc);

                    const destFloorCount = await Flat.countDocuments({
                        societyId: req.user.societyId,
                        floor: targetFloor,
                        _id: { $ne: flat._id }, // Exclude the flat being moved
                        $or: wingMatchConditions,
                    });

                    if (destFloorCount >= effectiveMaxUnits) {
                        return sendError(
                            res,
                            400,
                            `Floor ${targetFloor} of Wing ${wing.name} has reached its maximum capacity of ${effectiveMaxUnits} unit(s).`
                        );
                    }
                }
                updates.floor = targetFloor;
            }

            // 4. Validate flatNumber uniqueness if updated
            if (updates.flatNumber !== undefined) {
                const trimmed = String(updates.flatNumber || "").trim();
                if (!trimmed) {
                    return sendError(res, 400, "Flat number cannot be empty.");
                }
                if (trimmed !== flat.flatNumber) {
                    if (wing) {
                        const wingMatchConditions = buildWingMatchConditions(wing, blockDoc);
                        const dup = await Flat.findOne({
                            societyId: req.user.societyId,
                            flatNumber: trimmed,
                            _id: { $ne: flat._id },
                            $or: wingMatchConditions,
                        });
                        if (dup) {
                            return sendError(res, 400, "A flat with this number already exists in this wing.");
                        }
                    }
                    updates.flatNumber = trimmed;
                }
            }

            const updatedFlat = await Flat.findOneAndUpdate(
                { _id: flatId, societyId: req.user.societyId },
                { $set: updates },
                { new: true, runValidators: true }
            );

            if (!updatedFlat) {
                return sendError(res, 404, "Flat not found or could not be updated");
            }

            return sendSuccess(res, 200, "Flat updated successfully", { flat: updatedFlat });
        } catch (error) {
            if (error.code === 11000) {
                error.message = "A flat with this number already exists in this wing.";
                error.statusCode = 400;
            }
            next(error);
        }
    }

    async allocateResident(req, res, next) {
        try {
            const { flatId } = req.params;
            const operationsDb = getOperationsConnection();
            const Flat = operationsDb.model("Flat");
            const Resident = operationsDb.model("Resident");
            const User = operationsDb.model("User");

            // 1. Find the flat
            const flat = await Flat.findOne({ _id: flatId, societyId: req.user.societyId });
            if (!flat) {
                return sendError(res, 404, "Flat not found");
            }

            // 2. Validate it is vacant
            if (flat.status !== FLAT_STATUS.VACANT && flat.occupancyStatus !== "Vacant") {
                return sendError(res, 400, "Flat is already occupied");
            }

            const { userId, name, email, phone, residentType, occupancyStatus } = req.body;
            const isOwner = residentType === "owner";
            const isVacant = isOwner && (occupancyStatus === "Vacant" || occupancyStatus === "vacant");

            let resultUser;
            let devInviteLink;

            if (userId) {
                // --- Existing resident path ---
                resultUser = await User.findOne({ _id: userId, societyId: req.user.societyId }).lean();
                if (!resultUser) {
                    return sendError(res, 404, "Resident not found in this society");
                }

                // Upsert Resident record
                await Resident.findOneAndUpdate(
                    { societyId: req.user.societyId, userId: resultUser._id },
                    {
                        $set: {
                            flatId: flat._id,
                            residentType,
                            isActive: true,
                            moveInDate: isVacant ? null : new Date(),
                        },
                    },
                    { upsert: true, new: true }
                );
            } else {
                // --- New resident path (invite) ---
                const ResidentService = require("../resident/resident.service");
                const result = await ResidentService.inviteResident(req.user.societyId, {
                    name,
                    email,
                    phone,
                    residentType,
                    flatId: flat._id,
                    flatNumber: flat.flatNumber,
                    blockId: flat.blockId,
                    occupancyStatus: isVacant ? "Vacant" : (isOwner ? "Owner Occupied" : "Tenant Occupied"),
                });
                resultUser = result.user;
                devInviteLink = result.devInviteLink;
            }

            const ResidentRepository = require("../resident/resident.repository");
            const updatedFlat = await ResidentRepository.syncFlatOccupancy(
                req.user.societyId,
                flat._id,
                {
                    ownerName: isOwner ? (resultUser.name || name) : undefined,
                    ownerContact: isOwner ? (resultUser.mobile || phone) : undefined,
                    occupancyStatus: isVacant ? "Vacant" : (isOwner ? "Owner Occupied" : "Tenant Occupied"),
                    isVacant,
                }
            );

            return sendSuccess(res, 200, "Resident allocated successfully", {
                flat: updatedFlat,
                user: resultUser,
                ...(devInviteLink && { devInviteLink }),
            });

        } catch (error) {
            next(error);
        }
    }

}

module.exports = new FlatController();
