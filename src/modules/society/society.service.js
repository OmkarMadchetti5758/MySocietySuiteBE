"use strict";

const SocietyRepository = require("./society.repository");
const UserRepository = require("../user/user.repository");
const AppError = require("../../common/AppError");
const { SOCIETY_ERRORS } = require("./society.constants");
class SocietyService {
    async registerSociety(data) {
        const { societyName, adminName, adminEmail, adminMobile, adminPassword, address } = data;

        // 1. Check if society name is already taken
        const societyExists = await SocietyRepository.checkSocietyExists(societyName);
        if (societyExists) {
            throw new AppError("A society with this name already exists.", 400);
        }

        // 2. Check if identifiers (email/mobile) are already mapped in Master DB
        const emailExists = await SocietyRepository.checkIdentifierExists(adminEmail);
        const mobileExists = await SocietyRepository.checkIdentifierExists(adminMobile);
        
        if (emailExists || mobileExists) {
            throw new AppError(SOCIETY_ERRORS.IDENTIFIER_TAKEN, 400);
        }

        // 3. Create Society in Master DB
        const societyData = {
            name: societyName,
            contactEmail: adminEmail || undefined,
            contactPhone: adminMobile || undefined,
            address: address || {},
            status: "active"
        };
        const newSociety = await SocietyRepository.createSociety(societyData);

        // 4. Create Admin User in Operations DB
        const adminData = {
            name: adminName,
            email: adminEmail,
            mobile: adminMobile,
            password: adminPassword,
            role: "admin",
            isActive: true
        };

        const adminUser = await UserRepository.createUser(newSociety._id, adminData);

        // 5. Create mapping in Master DB so they can login globally
        const mappings = [
            adminEmail ? {
                identifier: adminEmail,
                societyId: newSociety._id,
                userId: adminUser._id,
                roleKeys: ["admin"],
            } : null,
            adminMobile ? {
                identifier: adminMobile,
                societyId: newSociety._id,
                userId: adminUser._id,
                roleKeys: ["admin"],
            } : null,
        ].filter(Boolean);
        await SocietyRepository.createUserMappings(mappings);

        return {
            society: newSociety,
            admin: {
                id: adminUser._id,
                name: adminUser.name,
                email: adminUser.email
            }
        };
    }

    async getActiveSocieties() {
        return SocietyRepository.getActiveSocieties();
    }

    async getCurrentSociety(societyId) {
        if (!societyId) throw new AppError("Society ID is required", 400);
        const society = await SocietyRepository.getSocietyById(societyId);
        if (!society) throw new AppError("Society not found", 404);
        return society;
    }

    async updateCurrentSociety(societyId, updateData) {
        if (!societyId) throw new AppError("Society ID is required", 400);
        
        // Remove fields that shouldn't be updated through this endpoint if any
        delete updateData._id;
        delete updateData.status;

        const updatedSociety = await SocietyRepository.updateSociety(societyId, updateData);
        if (!updatedSociety) {
            throw new AppError("Society not found", 404);
        }
        return updatedSociety;
    }
}

module.exports = new SocietyService();
