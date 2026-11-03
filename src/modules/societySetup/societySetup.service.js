"use strict";

const mongoose = require("mongoose");
const { getMasterConnection } = require("../../config/masterDb");
const { getOperationsConnection } = require("../../config/operationsDb");
const AppError = require("../../common/AppError");

class SocietySetupService {
    _getSocietyModel() {
        return getMasterConnection().model("Society");
    }

    _getBlockModel() {
        return getOperationsConnection().model("Block");
    }

    _getAmenityModel() {
        return getOperationsConnection().model("Amenity");
    }

    _getContactModel() {
        return getOperationsConnection().model("SocietyContact");
    }

    _getDocumentModel() {
        return getOperationsConnection().model("Document");
    }

    _getFlatModel() {
        return getOperationsConnection().model("Flat");
    }

    /**
     * Get setup status for a society
     */
    async getStatus(societyId) {
        if (!societyId) throw new AppError("Society ID is required", 400);

        const Society = this._getSocietyModel();
        const society = await Society.findById(societyId).select("name status setupStatus setupProgress").lean();

        if (!society) {
            throw new AppError("Society not found", 404);
        }

        return {
            societyId,
            societyName: society.name,
            setupStatus: society.setupStatus || "not_started",
            currentStep: society.setupProgress?.currentStep || 1,
            completedSteps: society.setupProgress?.completedSteps || [],
            lastSavedAt: society.setupProgress?.lastSavedAt || null,
            isCompleted: society.setupStatus === "completed",
        };
    }

    /**
     * Load existing setup draft or current DB state formatted for wizard
     */
    async getDraft(societyId) {
        if (!societyId) throw new AppError("Society ID is required", 400);

        const Society = this._getSocietyModel();
        const Block = this._getBlockModel();
        const Amenity = this._getAmenityModel();
        const SocietyContact = this._getContactModel();
        const Document = this._getDocumentModel();

        const [society, blockDoc, amenities, contacts, documents] = await Promise.all([
            Society.findById(societyId).lean(),
            Block.findOne({ societyId }).lean(),
            Amenity.find({ societyId }).lean(),
            SocietyContact.find({ societyId }).lean(),
            Document.find({ societyId }).lean(),
        ]);

        if (!society) {
            throw new AppError("Society not found", 404);
        }

        const societyDetails = {
            societyName: society.name || "",
            societyType: society.societyType || "Mixed (Residential + Commercial)",
            registrationNumber: society.registrationNumber || "",
            registrationDate: society.registrationDate ? new Date(society.registrationDate).toISOString().split("T")[0] : "",
            societyCode: society.societyCode || "",
            status: society.setupStatus === "completed" ? "Active" : "Setup / Pending",
            streetAddress: society.address?.street || "",
            city: society.address?.city || "",
            state: society.address?.state || "",
            pincode: society.address?.zipCode || "",
            contactEmail: society.contactEmail || "",
            contactPhone: society.contactPhone || "",
            logo: society.logo || "",
        };

        const propertyInfo = {
            projectName: society.projectInfo?.projectName || society.name || "",
            developerName: society.projectInfo?.developerName || "",
            projectStartDate: society.projectInfo?.projectStartDate ? new Date(society.projectInfo.projectStartDate).toISOString().split("T")[0] : "",
            expectedCompletionDate: society.projectInfo?.expectedCompletionDate ? new Date(society.projectInfo.expectedCompletionDate).toISOString().split("T")[0] : "",
            actualCompletionDate: society.projectInfo?.actualCompletionDate ? new Date(society.projectInfo.actualCompletionDate).toISOString().split("T")[0] : "",
            possessionStartDate: society.projectInfo?.possessionStartDate ? new Date(society.projectInfo.possessionStartDate).toISOString().split("T")[0] : "",
            totalProjectArea: society.projectInfo?.totalProjectArea || "",
            totalDevelopedArea: society.projectInfo?.totalDevelopedArea || "",
            numberOfBuildings: society.projectInfo?.numberOfBuildings || blockDoc?.wings?.length || 1,
            propertyType: society.projectInfo?.propertyType || society.societyType || "Residential",
        };

        const residentialInventory = (blockDoc?.wings || []).map((w, idx) => {
            const unitCount = w.unitCount || w.totalFlats || 0;
            // Preserve existing totalFloors if present, otherwise calculate safely without forcing 1
            const totalFloors = w.totalFloors && w.totalFloors > 0
                ? w.totalFloors
                : (unitCount > 0 ? Math.ceil(unitCount / 4) : 1);
            // Safe fallback for unitsPerFloor matching existing records and 4-unit generator
            const unitsPerFloor = w.unitsPerFloor && w.unitsPerFloor > 0
                ? w.unitsPerFloor
                : (totalFloors > 0 && unitCount > 0 && Math.ceil(unitCount / totalFloors) > 4
                    ? Math.ceil(unitCount / totalFloors)
                    : 4);

            return {
                id: w._id ? w._id.toString() : `res-${idx + 1}`,
                wing: w.name,
                propertyType: w.propertyType || "Flat / Apartment",
                configuration: w.configuration || "2 BHK",
                unitCount,
                carpetArea: w.carpetArea || 650,
                builtUpArea: w.builtUpArea || 900,
                parking4W: w.parking4W || 0,
                totalFloors,
                unitsPerFloor,
            };
        });

        const commercialInventory = (blockDoc?.commercialUnits || []).map((c, idx) => ({
            id: c._id ? c._id.toString() : `com-${idx + 1}`,
            block: c.block || "Commercial Block",
            commercialType: c.commercialType || "Shop",
            unitSize: c.unitSize || 300,
            unitCount: c.unitCount || 0,
            parking: c.parking || 0,
        }));

        const parkingConfig = {
            fourWheeler: society.parkingConfig?.fourWheeler || 0,
            twoWheeler: society.parkingConfig?.twoWheeler || 0,
            visitor: society.parkingConfig?.visitor || 0,
            evCharging: society.parkingConfig?.evCharging || 0,
            allocationMethod: society.parkingConfig?.allocationMethod || "By Society",
        };

        const formattedAmenities = amenities.map((a, idx) => ({
            id: a._id ? a._id.toString() : `am-${idx + 1}`,
            name: a.name,
            description: a.description || "",
            category: a.category || "Recreation",
            location: a.location || "Ground Floor",
            bookable: Boolean(a.bookable),
            chargesApplicable: Boolean(a.chargesApplicable),
            operatingHours: a.operatingHours || "06:00 AM - 10:00 PM",
            status: a.status || "Active",
            iconType: a.iconType || "clubhouse",
        }));

        const formattedContacts = contacts.map((c, idx) => ({
            id: c._id ? c._id.toString() : `cnt-${idx + 1}`,
            contactType: c.contactType || "Society Office",
            category: c.category || "Essential",
            nameCompany: c.nameCompany || "",
            contactPerson: c.contactPerson || "",
            mobileNumber: c.mobileNumber || "",
            emailId: c.emailId || "",
            roleDesignation: c.roleDesignation || "",
            status: c.status || "Active",
            iconType: c.iconType || "office",
        }));

        const formattedDocuments = documents.map((d, idx) => {
            const uploadDate = d.createdAt
                ? new Date(d.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                : "—";
            const expiryDate = d.expiryDate
                ? new Date(d.expiryDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                : null;

            return {
                id: d._id ? d._id.toString() : `doc-${idx + 1}`,
                documentName: d.title,
                category: d.category,
                isMandatory: Boolean(d.isMandatory),
                uploadedBy: "Super Admin",
                uploadDate,
                expiryDate,
                status: d.documentStatus || "Pending",
                fileSize: d.fileSize ? (d.fileSize > 1024 * 1024 ? `${(d.fileSize / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(d.fileSize / 1024)} KB`) : "—",
                fileType: d.fileType || "pdf",
                fileUrl: d.fileUrl || "",
            };
        });

        return {
            societyDetails,
            propertyInfo,
            residentialInventory,
            commercialInventory,
            parkingConfig,
            amenities: formattedAmenities,
            contacts: formattedContacts,
            documents: formattedDocuments,
            currentStep: society.setupProgress?.currentStep || 1,
            completedSteps: society.setupProgress?.completedSteps || [],
            setupStatus: society.setupStatus || "in_progress",
        };
    }

    /**
     * Save Step 1: Society Details
     */
    async saveStep1(societyId, details) {
        if (!societyId) throw new AppError("Society ID is required", 400);

        const Society = this._getSocietyModel();
        const society = await Society.findById(societyId);
        if (!society) throw new AppError("Society not found", 404);

        if (details.societyName) society.name = details.societyName.trim();
        if (details.societyType) society.societyType = details.societyType;
        if (details.registrationNumber !== undefined) society.registrationNumber = details.registrationNumber;
        if (details.registrationDate) society.registrationDate = new Date(details.registrationDate);
        if (details.societyCode !== undefined) society.societyCode = details.societyCode;
        if (details.logo !== undefined) society.logo = details.logo;

        if (details.contactEmail) society.contactEmail = details.contactEmail.trim().toLowerCase();
        if (details.contactPhone) society.contactPhone = details.contactPhone.trim();

        society.address = {
            street: details.streetAddress || society.address?.street || "",
            city: details.city || society.address?.city || "",
            state: details.state || society.address?.state || "",
            zipCode: details.pincode || society.address?.zipCode || "",
            country: "India",
        };

        const completedSteps = new Set(society.setupProgress?.completedSteps || []);
        completedSteps.add(1);

        society.setupProgress = {
            currentStep: Math.max(society.setupProgress?.currentStep || 1, 2),
            completedSteps: Array.from(completedSteps),
            lastSavedAt: new Date(),
        };

        if (society.setupStatus === "not_started") {
            society.setupStatus = "in_progress";
        }

        await society.save();
        return this.getStatus(societyId);
    }

    /**
     * Save Step 2: Property Inventory
     */
    async saveStep2(societyId, { propertyInfo, residentialInventory, commercialInventory, parkingConfig }) {
        if (!societyId) throw new AppError("Society ID is required", 400);

        const Society = this._getSocietyModel();
        const Block = this._getBlockModel();

        const society = await Society.findById(societyId);
        if (!society) throw new AppError("Society not found", 404);

        if (propertyInfo) {
            society.projectInfo = {
                projectName: propertyInfo.projectName || society.name,
                developerName: propertyInfo.developerName || "",
                projectStartDate: propertyInfo.projectStartDate ? new Date(propertyInfo.projectStartDate) : undefined,
                expectedCompletionDate: propertyInfo.expectedCompletionDate ? new Date(propertyInfo.expectedCompletionDate) : undefined,
                actualCompletionDate: propertyInfo.actualCompletionDate ? new Date(propertyInfo.actualCompletionDate) : undefined,
                possessionStartDate: propertyInfo.possessionStartDate ? new Date(propertyInfo.possessionStartDate) : undefined,
                totalProjectArea: Number(propertyInfo.totalProjectArea) || 0,
                totalDevelopedArea: Number(propertyInfo.totalDevelopedArea) || 0,
                numberOfBuildings: Number(propertyInfo.numberOfBuildings) || 1,
                propertyType: propertyInfo.propertyType || society.societyType || "Residential",
            };
        }

        if (parkingConfig) {
            society.parkingConfig = {
                fourWheeler: Number(parkingConfig.fourWheeler) || 0,
                twoWheeler: Number(parkingConfig.twoWheeler) || 0,
                visitor: Number(parkingConfig.visitor) || 0,
                evCharging: Number(parkingConfig.evCharging) || 0,
                allocationMethod: parkingConfig.allocationMethod || "By Society",
            };
        }

        // Upsert Block with Wings & Commercial Units
        const wings = (residentialInventory || []).map((item) => {
            const rawWingName = item.wing || "A Wing";
            const code = rawWingName.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase() || "W1";
            const unitCount = Number(item.unitCount) || 0;
            const unitsPerFloor = Number(item.unitsPerFloor) || (Number(item.totalFloors) && unitCount ? Math.ceil(unitCount / Number(item.totalFloors)) : 4);
            const totalFloors = Number(item.totalFloors) || (unitCount > 0 ? Math.ceil(unitCount / unitsPerFloor) : 1);
            return {
                name: rawWingName,
                code,
                totalFloors,
                unitsPerFloor,
                totalFlats: unitCount,
                propertyType: item.propertyType || "Flat / Apartment",
                configuration: item.configuration || "2 BHK",
                unitCount,
                carpetArea: Number(item.carpetArea) || 0,
                builtUpArea: Number(item.builtUpArea) || 0,
                parking4W: Number(item.parking4W) || 0,
                status: "Active",
            };
        });

        const commercialUnits = (commercialInventory || []).map((item) => ({
            block: item.block || "Commercial Block",
            commercialType: item.commercialType || "Shop",
            unitSize: Number(item.unitSize) || 0,
            unitCount: Number(item.unitCount) || 0,
            parking: Number(item.parking) || 0,
        }));

        await Block.findOneAndUpdate(
            { societyId },
            { societyId, wings, commercialUnits },
            { upsert: true, new: true, runValidators: true }
        );

        society.numberOfBlocks = wings.length;
        society.blocks = wings.map((w) => w.name);

        const completedSteps = new Set(society.setupProgress?.completedSteps || []);
        completedSteps.add(2);

        society.setupProgress = {
            currentStep: Math.max(society.setupProgress?.currentStep || 1, 3),
            completedSteps: Array.from(completedSteps),
            lastSavedAt: new Date(),
        };

        await society.save();
        return this.getStatus(societyId);
    }

    /**
     * Save Step 3: Amenities
     */
    async saveStep3(societyId, amenitiesList = []) {
        if (!societyId) throw new AppError("Society ID is required", 400);

        const Amenity = this._getAmenityModel();
        const Society = this._getSocietyModel();

        const society = await Society.findById(societyId);
        if (!society) throw new AppError("Society not found", 404);

        await Amenity.deleteMany({ societyId });

        if (Array.isArray(amenitiesList) && amenitiesList.length > 0) {
            const docsToInsert = amenitiesList.map((a) => ({
                societyId,
                name: a.name,
                description: a.description || "",
                category: a.category || "Recreation",
                location: a.location || "Ground Floor",
                bookable: Boolean(a.bookable),
                chargesApplicable: Boolean(a.chargesApplicable),
                operatingHours: a.operatingHours || "06:00 AM - 10:00 PM",
                status: a.status || "Active",
                iconType: a.iconType || "clubhouse",
            }));

            await Amenity.insertMany(docsToInsert);
        }

        const completedSteps = new Set(society.setupProgress?.completedSteps || []);
        completedSteps.add(3);

        society.setupProgress = {
            currentStep: Math.max(society.setupProgress?.currentStep || 1, 4),
            completedSteps: Array.from(completedSteps),
            lastSavedAt: new Date(),
        };

        await society.save();
        return this.getStatus(societyId);
    }

    /**
     * Save Step 4: Contacts
     */
    async saveStep4(societyId, contactsList = []) {
        if (!societyId) throw new AppError("Society ID is required", 400);

        const SocietyContact = this._getContactModel();
        const Society = this._getSocietyModel();

        const society = await Society.findById(societyId);
        if (!society) throw new AppError("Society not found", 404);

        await SocietyContact.deleteMany({ societyId });

        if (Array.isArray(contactsList) && contactsList.length > 0) {
            const docsToInsert = contactsList.map((c) => ({
                societyId,
                contactType: c.contactType || "Society Office",
                category: c.category || "Essential",
                nameCompany: c.nameCompany || "",
                contactPerson: c.contactPerson || "",
                mobileNumber: c.mobileNumber || "",
                emailId: c.emailId ? c.emailId.toLowerCase().trim() : undefined,
                roleDesignation: c.roleDesignation || "",
                status: c.status || "Active",
                iconType: c.iconType || "office",
            }));

            await SocietyContact.insertMany(docsToInsert);
        }

        const completedSteps = new Set(society.setupProgress?.completedSteps || []);
        completedSteps.add(4);

        society.setupProgress = {
            currentStep: Math.max(society.setupProgress?.currentStep || 1, 5),
            completedSteps: Array.from(completedSteps),
            lastSavedAt: new Date(),
        };

        await society.save();
        return this.getStatus(societyId);
    }

    /**
     * Save Step 5: Documents
     */
    async saveStep5(societyId, documentsList = [], userId) {
        if (!societyId) throw new AppError("Society ID is required", 400);

        const Document = this._getDocumentModel();
        const Society = this._getSocietyModel();

        const society = await Society.findById(societyId);
        if (!society) throw new AppError("Society not found", 404);

        await Document.deleteMany({ societyId });

        if (Array.isArray(documentsList) && documentsList.length > 0) {
            const docsToInsert = documentsList.map((d) => ({
                societyId,
                title: d.documentName || d.title || "Document",
                category: d.category || "Legal",
                isMandatory: Boolean(d.isMandatory),
                fileUrl: d.fileUrl || "/uploads/placeholder.pdf",
                fileName: d.fileName || `${d.documentName || 'Document'}.pdf`,
                fileSize: typeof d.fileSize === "number" ? d.fileSize : 2048576,
                fileType: d.fileType || "pdf",
                uploadedBy: userId,
                expiryDate: d.expiryDate ? new Date(d.expiryDate) : undefined,
                documentStatus: d.status || d.documentStatus || "Pending",
                visibilityScope: "All Residents",
            }));

            await Document.insertMany(docsToInsert);
        }

        const completedSteps = new Set(society.setupProgress?.completedSteps || []);
        completedSteps.add(5);

        society.setupProgress = {
            currentStep: Math.max(society.setupProgress?.currentStep || 1, 6),
            completedSteps: Array.from(completedSteps),
            lastSavedAt: new Date(),
        };

        await society.save();
        return this.getStatus(societyId);
    }

    /**
     * Save entire wizard state as draft
     */
    async saveDraft(societyId, draftData, userId) {
        if (!societyId) throw new AppError("Society ID is required", 400);

        if (draftData.societyDetails) {
            await this.saveStep1(societyId, draftData.societyDetails);
        }

        if (draftData.propertyInfo || draftData.residentialInventory || draftData.commercialInventory || draftData.parkingConfig) {
            await this.saveStep2(societyId, {
                propertyInfo: draftData.propertyInfo,
                residentialInventory: draftData.residentialInventory,
                commercialInventory: draftData.commercialInventory,
                parkingConfig: draftData.parkingConfig,
            });
        }

        if (draftData.amenities) {
            await this.saveStep3(societyId, draftData.amenities);
        }

        if (draftData.contacts) {
            await this.saveStep4(societyId, draftData.contacts);
        }

        if (draftData.documents) {
            await this.saveStep5(societyId, draftData.documents, userId);
        }

        const Society = this._getSocietyModel();
        const society = await Society.findById(societyId);
        if (society) {
            if (draftData.currentStep) {
                society.setupProgress.currentStep = draftData.currentStep;
            }
            if (Array.isArray(draftData.completedSteps)) {
                society.setupProgress.completedSteps = draftData.completedSteps;
            }
            society.setupProgress.lastSavedAt = new Date();
            await society.save();
        }

        return this.getStatus(societyId);
    }

    /**
     * Step 6: Activate Society and generate flats
     */
    async activateSociety(societyId, finalData, userId) {
        if (!societyId) throw new AppError("Society ID is required", 400);

        const Society = this._getSocietyModel();
        const Block = this._getBlockModel();
        const Flat = this._getFlatModel();

        if (finalData) {
            await this.saveDraft(societyId, finalData, userId);
        }

        const society = await Society.findById(societyId);
        if (!society) throw new AppError("Society not found", 404);

        society.setupStatus = "completed";
        society.status = "active";
        society.setupProgress = {
            currentStep: 6,
            completedSteps: [1, 2, 3, 4, 5, 6],
            lastSavedAt: new Date(),
        };

        await society.save();

        // Auto-generate flats if none exist
        const existingFlats = await Flat.find({ societyId }).select("flatNumber").lean();
        const existingFlatsCount = existingFlats.length;
        if (existingFlatsCount === 0) {
            const blockDoc = await Block.findOne({ societyId });
            if (blockDoc && Array.isArray(blockDoc.wings)) {
                const existingSet = new Set(existingFlats.map((f) => f.flatNumber));
                const flatsToCreate = [];

                for (const wing of blockDoc.wings) {
                    const wingLetter = (wing.name || "A").trim().split(" ")[0] || "A";
                    const count = wing.unitCount || wing.totalFlats || 0;
                    const perUnitParking = wing.unitCount > 0 && wing.parking4W ? Math.floor(wing.parking4W / wing.unitCount) : 0;
                    const unitsPerFloor = Number(wing.unitsPerFloor) || (wing.totalFloors && count ? Math.ceil(count / wing.totalFloors) : 4);

                    for (let i = 1; i <= count; i++) {
                        const floorNum = Math.floor((i - 1) / unitsPerFloor) + 1;
                        const unitInFloor = ((i - 1) % unitsPerFloor) + 1;
                        const unitSuffix = String(unitInFloor).padStart(2, "0");
                        const flatNumber = `${wingLetter}-${floorNum}${unitSuffix}`;

                        if (!existingSet.has(flatNumber)) {
                            existingSet.add(flatNumber);
                            flatsToCreate.push({
                                societyId,
                                blockId: blockDoc._id,
                                flatNumber,
                                floor: floorNum,
                                type: wing.configuration || "2 BHK",
                                area: wing.carpetArea || 650,
                                ownershipType: "Owned",
                                occupancyStatus: "Vacant",
                                parkingSlots: perUnitParking,
                                status: "vacant",
                                isActive: true,
                            });
                        }
                    }
                }

                if (flatsToCreate.length > 0) {
                    await Flat.insertMany(flatsToCreate, { ordered: false }).catch((err) => {
                        console.warn("Notice: some flats may have already existed during bulk generation", err.message);
                    });
                }
            }
        }

        return {
            message: "Society successfully setup and activated!",
            setupStatus: "completed",
            societyId,
        };
    }
}

module.exports = new SocietySetupService();
