"use strict";

const mongoose = require("mongoose");
const { getOperationsConnection } = require("../../config/operationsDb");
const { sendSuccess, sendError } = require("../../utils/response.utils");
const { FLAT_STATUS } = require("../../common/constants");

class FlatController {
    async getFlats(req, res, next) {
        try {
            const { blockId } = req.query;
            const operationsDb = getOperationsConnection();
            const Flat = operationsDb.model("Flat");

            const filter = { societyId: req.user.societyId };
            if (blockId) filter.blockId = blockId;

            const flats = await Flat.find(filter).sort({ floor: 1, flatNumber: 1 });

            return sendSuccess(res, 200, "Flats retrieved successfully", { flats });
        } catch (error) {
            next(error);
        }
    }

    async createFlat(req, res, next) {
        try {
            const operationsDb = getOperationsConnection();
            const Flat = operationsDb.model("Flat");

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

            const newFlat = new Flat({
                societyId: req.user.societyId,
                blockId,
                floor,
                flatNumber,
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
                error.message = "Flat with this number already exists.";
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
                error.message = "Flat with this number already exists.";
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

            const { userId, name, email, phone, residentType } = req.body;
            const isOwner = residentType === "owner";

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
                            moveInDate: new Date(),
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
                    flatNumber: flat.flatNumber,
                });
                resultUser = result.user;
                devInviteLink = result.devInviteLink;
            }

            // 3. Update the flat document
            const updates = {
                status: FLAT_STATUS.OCCUPIED,
                occupancyStatus: isOwner ? "Owner Occupied" : "Tenant Occupied",
                ownerName: isOwner ? (resultUser.name || name) : flat.ownerName,
                ownerContact: isOwner ? (resultUser.mobile || phone) : flat.ownerContact,
                numberOfResidents: (flat.numberOfResidents || 0) + 1,
            };

            if (isOwner) {
                updates.primaryOwner = resultUser._id;
            } else {
                updates.activeTenant = resultUser._id;
            }

            const updatedFlat = await Flat.findOneAndUpdate(
                { _id: flat._id },
                { $set: updates },
                { new: true, runValidators: true }
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
