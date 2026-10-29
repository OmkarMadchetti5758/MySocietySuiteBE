"use strict";

const BlockRepository = require("./block.repository");
const AppError = require("../../common/AppError");

class BlockService {
    async getWings(societyId) {
        if (!societyId) throw new AppError("Society ID is required", 400);
        const blockDoc = await BlockRepository.getBlocksBySociety(societyId);
        return blockDoc || { societyId, wings: [], commercialUnits: [] };
    }

    async saveWings(societyId, wings, commercialUnits) {
        if (!societyId) throw new AppError("Society ID is required", 400);
        if (!Array.isArray(wings)) throw new AppError("Wings must be an array", 400);

        const updatedDoc = await BlockRepository.upsertBlocks(societyId, wings, commercialUnits);

        // Sync society blocks and numberOfBlocks
        if (Array.isArray(wings)) {
            await BlockRepository.updateSocietyData(societyId, {
                blocks: wings.map((w) => w.name),
                numberOfBlocks: wings.length,
            });
        }

        return updatedDoc;
    }

    async getInventory(societyId) {
        if (!societyId) throw new AppError("Society ID is required", 400);

        const [blockDoc, societyDoc, staffList] = await Promise.all([
            BlockRepository.getBlocksBySociety(societyId),
            BlockRepository.getSocietyById(societyId),
            BlockRepository.getStaffList(societyId),
        ]);

        const wings = blockDoc?.wings || [];
        const commercialUnits = blockDoc?.commercialUnits || [];

        const residentialInventory = wings.map((w, idx) => ({
            id: w._id ? w._id.toString() : `res-${idx + 1}`,
            _id: w._id,
            wing: w.name,
            name: w.name,
            code: w.code || "",
            totalFloors: w.totalFloors ?? 0,
            unitsPerFloor: w.unitsPerFloor ?? (w.totalFloors > 0 && (w.unitCount || w.totalFlats) ? Math.ceil((w.unitCount || w.totalFlats) / w.totalFloors) : 4),
            totalFlats: w.totalFlats ?? w.unitCount ?? 0,
            propertyType: w.propertyType || "Flat / Apartment",
            configuration: w.configuration || "2 BHK",
            unitCount: w.unitCount ?? w.totalFlats ?? 0,
            carpetArea: w.carpetArea ?? 0,
            builtUpArea: w.builtUpArea ?? 0,
            parking4W: w.parking4W ?? 0,
            status: w.status || "Active",
            assignedStaff: w.assignedStaff?._id || w.assignedStaff || "",
        }));

        const commercialInventory = commercialUnits.map((c, idx) => ({
            id: c._id ? c._id.toString() : `com-${idx + 1}`,
            _id: c._id,
            block: c.block || "Commercial Block",
            commercialType: c.commercialType || "Shop",
            unitSize: c.unitSize ?? 0,
            unitCount: c.unitCount ?? 0,
            parking: c.parking ?? 0,
        }));

        const propertyInfo = {
            projectName: societyDoc?.projectInfo?.projectName || societyDoc?.name || "",
            developerName: societyDoc?.projectInfo?.developerName || "",
            projectStartDate: societyDoc?.projectInfo?.projectStartDate ? new Date(societyDoc.projectInfo.projectStartDate).toISOString().split("T")[0] : "",
            expectedCompletionDate: societyDoc?.projectInfo?.expectedCompletionDate ? new Date(societyDoc.projectInfo.expectedCompletionDate).toISOString().split("T")[0] : "",
            actualCompletionDate: societyDoc?.projectInfo?.actualCompletionDate ? new Date(societyDoc.projectInfo.actualCompletionDate).toISOString().split("T")[0] : "",
            possessionStartDate: societyDoc?.projectInfo?.possessionStartDate ? new Date(societyDoc.projectInfo.possessionStartDate).toISOString().split("T")[0] : "",
            totalProjectArea: societyDoc?.projectInfo?.totalProjectArea || "",
            totalDevelopedArea: societyDoc?.projectInfo?.totalDevelopedArea || "",
            numberOfBuildings: societyDoc?.projectInfo?.numberOfBuildings || wings.length || 1,
            propertyType: societyDoc?.projectInfo?.propertyType || societyDoc?.societyType || "Residential",
        };

        const parkingConfig = {
            fourWheeler: societyDoc?.parkingConfig?.fourWheeler || 0,
            twoWheeler: societyDoc?.parkingConfig?.twoWheeler || 0,
            visitor: societyDoc?.parkingConfig?.visitor || 0,
            evCharging: societyDoc?.parkingConfig?.evCharging || 0,
            allocationMethod: societyDoc?.parkingConfig?.allocationMethod || "By Society",
        };

        return {
            residentialInventory,
            commercialInventory,
            propertyInfo,
            parkingConfig,
            staffList: staffList || [],
        };
    }

    async saveInventory(societyId, payload) {
        if (!societyId) throw new AppError("Society ID is required", 400);

        const {
            residentialInventory,
            commercialInventory,
            propertyInfo,
            parkingConfig,
            wings,
            commercialUnits,
        } = payload || {};

        const wingsData = wings || residentialInventory;
        const commercialData = commercialUnits || commercialInventory;

        let cleanedWings;
        if (Array.isArray(wingsData)) {
            cleanedWings = wingsData.map((w) => {
                const rawWingName = (w.wing || w.name || "A Wing").trim();
                const code = (w.code || rawWingName.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase()) || "W1";
                const unitCount = Number(w.unitCount || w.totalFlats) || 0;
                const totalFloors = Number(w.totalFloors) || (w.unitsPerFloor && unitCount ? Math.ceil(unitCount / Number(w.unitsPerFloor)) : 1);
                const unitsPerFloor = Number(w.unitsPerFloor) || (totalFloors > 0 && unitCount > 0 ? Math.ceil(unitCount / totalFloors) : 4);
                const item = {
                    name: rawWingName,
                    code,
                    totalFloors,
                    unitsPerFloor,
                    totalFlats: unitCount,
                    propertyType: w.propertyType || "Flat / Apartment",
                    configuration: w.configuration || "2 BHK",
                    unitCount,
                    carpetArea: Number(w.carpetArea) || 0,
                    builtUpArea: Number(w.builtUpArea) || 0,
                    parking4W: Number(w.parking4W) || 0,
                    status: w.status || "Active",
                };
                if (w._id && typeof w._id === "string" && w._id.length === 24) {
                    item._id = w._id;
                }
                if (w.assignedStaff && typeof w.assignedStaff === "string" && w.assignedStaff.length === 24) {
                    item.assignedStaff = w.assignedStaff;
                }
                return item;
            });
        }

        let cleanedCommercial;
        if (Array.isArray(commercialData)) {
            cleanedCommercial = commercialData.map((c) => {
                const item = {
                    block: (c.block || "Commercial Block").trim(),
                    commercialType: c.commercialType || "Shop",
                    unitSize: Number(c.unitSize) || 0,
                    unitCount: Number(c.unitCount) || 0,
                    parking: Number(c.parking) || 0,
                };
                if (c._id && typeof c._id === "string" && c._id.length === 24) {
                    item._id = c._id;
                }
                return item;
            });
        }

        await BlockRepository.upsertBlocks(societyId, cleanedWings, cleanedCommercial);

        // Update society document with project info, parking config, and block list
        const societyUpdates = {};
        if (cleanedWings) {
            societyUpdates.blocks = cleanedWings.map((w) => w.name);
            societyUpdates.numberOfBlocks = cleanedWings.length;
        }
        if (propertyInfo) {
            societyUpdates.projectInfo = {
                projectName: propertyInfo.projectName,
                developerName: propertyInfo.developerName,
                projectStartDate: propertyInfo.projectStartDate ? new Date(propertyInfo.projectStartDate) : undefined,
                expectedCompletionDate: propertyInfo.expectedCompletionDate ? new Date(propertyInfo.expectedCompletionDate) : undefined,
                actualCompletionDate: propertyInfo.actualCompletionDate ? new Date(propertyInfo.actualCompletionDate) : undefined,
                possessionStartDate: propertyInfo.possessionStartDate ? new Date(propertyInfo.possessionStartDate) : undefined,
                totalProjectArea: Number(propertyInfo.totalProjectArea) || 0,
                totalDevelopedArea: Number(propertyInfo.totalDevelopedArea) || 0,
                numberOfBuildings: Number(propertyInfo.numberOfBuildings) || (cleanedWings ? cleanedWings.length : 1),
                propertyType: propertyInfo.propertyType || "Residential",
            };
        }
        if (parkingConfig) {
            societyUpdates.parkingConfig = {
                fourWheeler: Number(parkingConfig.fourWheeler) || 0,
                twoWheeler: Number(parkingConfig.twoWheeler) || 0,
                visitor: Number(parkingConfig.visitor) || 0,
                evCharging: Number(parkingConfig.evCharging) || 0,
                allocationMethod: parkingConfig.allocationMethod || "By Society",
            };
        }

        if (Object.keys(societyUpdates).length > 0) {
            await BlockRepository.updateSocietyData(societyId, societyUpdates);
        }

        return this.getInventory(societyId);
    }

    async getStaffList(societyId) {
        if (!societyId) throw new AppError("Society ID is required", 400);
        return BlockRepository.getStaffList(societyId);
    }
}

module.exports = new BlockService();
