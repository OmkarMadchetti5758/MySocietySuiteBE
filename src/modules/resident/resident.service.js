"use strict";

const ResidentRepository = require("./resident.repository");
const SocietyRepository = require("../society/society.repository");
const AppError = require("../../common/AppError");
const { RESIDENT_ERRORS } = require("./resident.constants");

class ResidentService {
    async getResidents(societyId, page, limit, search) {
        const p = parseInt(page, 10) || 1;
        const l = parseInt(limit, 10) || 10;
        return ResidentRepository.getPaginatedResidents(societyId, p, l, search || "");
    }

    async inviteResident(societyId, data) {
        const email = data.email?.toLowerCase().trim();
        const phone = data.phone?.trim();

        const [existingUser, emailMapped, phoneMapped] = await Promise.all([
            ResidentRepository.findExistingUser(societyId, email, phone),
            SocietyRepository.checkIdentifierExists(email),
            SocietyRepository.checkIdentifierExists(phone),
        ]);

        if (existingUser) {
            if (existingUser.email === email) {
                throw new AppError(RESIDENT_ERRORS.EMAIL_EXISTS, 400);
            }
            if (existingUser.mobile === phone) {
                throw new AppError(RESIDENT_ERRORS.MOBILE_EXISTS, 400);
            }
        }

        if (emailMapped || phoneMapped) {
            throw new AppError(RESIDENT_ERRORS.IDENTIFIER_TAKEN, 400);
        }

        let result;
        try {
            result = await ResidentRepository.createResidentWithInvite(societyId, {
                ...data,
                email,
                phone,
            });
        } catch (error) {
            if (error.code === 11000) {
                throw new AppError(RESIDENT_ERRORS.IDENTIFIER_TAKEN, 400);
            }
            throw error;
        }

        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
        const inviteLink = `${frontendUrl}/activate-account?token=${result.plainToken}`;

        console.log("\n=============================================");
        console.log("=== DEV RESIDENT INVITE LINK ===");
        console.log(`Resident: ${result.user.name} (${result.user.email})`);
        console.log(`Flat: ${result.flat.flatNumber}`);
        console.log(`Link: ${inviteLink}`);
        console.log("=============================================\n");

        const userObj = { ...result.user.toObject() };
        delete userObj.password;

        return {
            user: userObj,
            flat: result.flat,
            ...(process.env.NODE_ENV === "development" ? { devInviteLink: inviteLink } : {}),
        };
    }
}

module.exports = new ResidentService();
