"use strict";

const SocietyRepository = require("./society.repository");
const UserRepository = require("../user/user.repository");
const AppError = require("../../common/AppError");
const { SOCIETY_ERRORS } = require("./society.constants");
const { getTenantConnection } = require("../../config/tenantDb");

class SocietyService {
    /**
     * Converts a society name into a safe database name (e.g., "Green Valley" -> "society_green_valley")
     */
    _generateDatabaseName(societyName) {
        const cleanName = societyName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
        return `society_${cleanName}`;
    }

    async registerSociety(data) {
        const { societyName, adminName, adminEmail, adminMobile, adminPassword, address } = data;

        // 1. Generate & check database name uniqueness
        const databaseName = this._generateDatabaseName(societyName);
        const dbExists = await SocietyRepository.checkDatabaseExists(databaseName);
        if (dbExists) {
            throw new AppError(SOCIETY_ERRORS.DATABASE_NAME_TAKEN, 400);
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
            databaseName: databaseName,
            contactEmail: adminEmail,
            contactPhone: adminMobile,
            address: address || {},
            status: "active"
        };
        const newSociety = await SocietyRepository.createSociety(societyData);

        // 4. Create Tenant DB and Admin User
        const tenantDb = await getTenantConnection(databaseName);

        // Pass plain text password — the User model's pre-save hook will hash it securely
        const adminData = {
            name: adminName,
            email: adminEmail,
            mobile: adminMobile,
            password: adminPassword,
            role: "admin",
            isActive: true
        };

        const adminUser = await UserRepository.createUser(tenantDb, adminData);

        // 5. Create mapping in Master DB so they can login globally
        const mappings = [
            { identifier: adminEmail, databaseName: databaseName },
            { identifier: adminMobile, databaseName: databaseName }
        ];
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
}

module.exports = new SocietyService();
