"use strict";

const TenantRegistrationRepository = require("./tenantRegistration.repository");
const AppError = require("../../common/AppError");
const { TENANT_ERRORS, TENANT_DOCUMENT_TYPES } = require("./tenantRegistration.constants");
const { getOperationsConnection } = require("../../config/operationsDb");
const { getMasterConnection } = require("../../config/masterDb");
const { uploadMulterFile } = require("../../services/storage.service");
const emailService = require("../../services/email.service");
const { FRONTEND_URL } = require("../../config/env");
const { ROLES, USER_STATUS, RESIDENT_TYPE, FLAT_STATUS } = require("../../common/constants");

class TenantRegistrationService {
    /**
     * Register a tenant for a flat owned by ownerId.
     */
    async registerTenant(societyId, ownerId, data, files) {
        const opsDb = getOperationsConnection();
        const masterDb = getMasterConnection();

        const Flat = opsDb.model("Flat");
        const User = opsDb.model("User");
        const Resident = opsDb.model("Resident");
        const UserSocietyMapping = masterDb.model("UserSocietyMapping");
        const InviteToken = masterDb.model("InviteToken");

        // 1. Validate flat belongs to society and ownerId === flat.primaryOwner
        const flat = await Flat.findOne({ _id: data.flatId, societyId }).lean();
        if (!flat) {
            throw new AppError(TENANT_ERRORS.FLAT_NOT_FOUND, 404);
        }
        if (!flat.primaryOwner || flat.primaryOwner.toString() !== ownerId.toString()) {
            throw new AppError(TENANT_ERRORS.FLAT_NOT_OWNED, 403);
        }

        // 2. Check no active TenantRegistration for this flatId
        const existing = await TenantRegistrationRepository.findActiveTenancyForFlat(societyId, data.flatId);
        if (existing) {
            throw new AppError(TENANT_ERRORS.ACTIVE_TENANCY_EXISTS, 400);
        }

        // 3. Upload required documents
        const identityProofFile = files?.identityProof?.[0];
        const rentalAgreementFile = files?.rentalAgreement?.[0];

        if (!identityProofFile) {
            throw new AppError(TENANT_ERRORS.IDENTITY_PROOF_REQUIRED, 400);
        }
        if (!rentalAgreementFile) {
            throw new AppError(TENANT_ERRORS.RENTAL_AGREEMENT_REQUIRED, 400);
        }

        const [identityUpload, rentalUpload] = await Promise.all([
            uploadMulterFile(identityProofFile, "tenants", societyId),
            uploadMulterFile(rentalAgreementFile, "tenants", societyId),
        ]);

        // 4. Upload optional documents
        const optionalFiles = files?.optionalDocs || [];
        const optionalUploads = await Promise.all(
            optionalFiles.map((f) => uploadMulterFile(f, "tenants", societyId))
        );

        // 5. Parse optional doc metadata if provided
        let optionalDocsMeta = [];
        if (data.optionalDocsMeta) {
            try {
                optionalDocsMeta = typeof data.optionalDocsMeta === "string"
                    ? JSON.parse(data.optionalDocsMeta)
                    : data.optionalDocsMeta;
            } catch (e) {
                optionalDocsMeta = [];
            }
        }

        // 6. Build documents array
        const documents = [
            {
                documentType: TENANT_DOCUMENT_TYPES.IDENTITY_PROOF,
                label: "Identity Proof",
                isRequired: true,
                fileUrl: identityUpload.url,
                fileKey: identityUpload.key,
                fileName: identityProofFile.originalname,
                fileSize: identityProofFile.size,
                mimeType: identityProofFile.mimetype,
                uploadedAt: new Date(),
            },
            {
                documentType: TENANT_DOCUMENT_TYPES.RENTAL_AGREEMENT,
                label: "Rental Agreement",
                isRequired: true,
                fileUrl: rentalUpload.url,
                fileKey: rentalUpload.key,
                fileName: rentalAgreementFile.originalname,
                fileSize: rentalAgreementFile.size,
                mimeType: rentalAgreementFile.mimetype,
                uploadedAt: new Date(),
            },
            ...optionalFiles.map((f, idx) => {
                const meta = optionalDocsMeta[idx] || {};
                const docType = meta.documentType || TENANT_DOCUMENT_TYPES.OTHER;
                const label = docType === "Other Document" && meta.otherDocumentName
                    ? `Other (${meta.otherDocumentName})`
                    : docType || f.originalname;
                return {
                    documentType: docType,
                    label,
                    isRequired: false,
                    fileUrl: optionalUploads[idx].url,
                    fileKey: optionalUploads[idx].key,
                    fileName: f.originalname,
                    fileSize: f.size,
                    mimeType: f.mimetype,
                    uploadedAt: new Date(),
                };
            }),
        ];

        // 7. Find or create User for tenant
        const email = data.email?.toLowerCase().trim();
        const mobile = data.mobileNumber?.trim();

        let tenantUser = await User.findOne({
            societyId,
            $or: [
                ...(email ? [{ email }] : []),
                ...(mobile ? [{ mobile }] : []),
            ],
        });

        let isNewUser = false;
        if (!tenantUser) {
            tenantUser = await User.create({
                societyId,
                name: data.fullName,
                email,
                mobile,
                role: ROLES.RESIDENT_TENANT,
                status: USER_STATUS.INVITED,
            });
            isNewUser = true;
        }

        // 8. Create TenantRegistration doc
        const registration = await TenantRegistrationRepository.createTenantRegistration(societyId, {
            flatId: data.flatId,
            ownerId,
            tenantUserId: tenantUser._id,
            fullName: data.fullName,
            mobileNumber: mobile,
            email,
            dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
            gender: data.gender || undefined,
            completeAddress: data.completeAddress || undefined,
            emergencyContactNumber: data.emergencyContactNumber || undefined,
            numberOfOccupants: data.numberOfOccupants ? Number(data.numberOfOccupants) : undefined,
            employmentType: data.employmentType || undefined,
            companyName: data.companyName || undefined,
            companyDescription: data.companyDescription || undefined,
            organizationName: data.organizationName || undefined,
            organizationAddress: data.organizationAddress || undefined,
            yearOfIncorporation: data.yearOfIncorporation || undefined,
            moveInDate: data.moveInDate ? new Date(data.moveInDate) : new Date(),
            moveOutDate: data.moveOutDate ? new Date(data.moveOutDate) : undefined,
            monthlyRent: data.monthlyRent ? Number(data.monthlyRent) : undefined,
            securityDeposit: data.securityDeposit ? Number(data.securityDeposit) : undefined,
            rentDueDay: data.rentDueDay ? Number(data.rentDueDay) : undefined,
            petAllowed: data.petAllowed === true || data.petAllowed === "true",
            status: "Active",
            referenceName: data.referenceName || undefined,
            referenceContactNumber: data.referenceContactNumber || undefined,
            referenceRelation: data.referenceRelation || undefined,
            documents,
            createdBy: ownerId,
        });

        // 9. Create Resident record
        await Resident.create({
            societyId,
            flatId: data.flatId,
            userId: tenantUser._id,
            residentType: RESIDENT_TYPE.TENANT,
            isActive: true,
            moveInDate: data.moveInDate ? new Date(data.moveInDate) : new Date(),
        });

        // 10. Update flat: occupancyStatus, activeTenant, currentTenantRegistrationId
        await Flat.findOneAndUpdate(
            { _id: data.flatId, societyId },
            {
                $set: {
                    occupancyStatus: "Tenant Occupied",
                    status: FLAT_STATUS.OCCUPIED,
                    activeTenant: tenantUser._id,
                    currentTenantRegistrationId: registration._id,
                },
            },
            { new: true }
        );

        // 11. Create UserSocietyMapping in masterDb
        const mappingEntries = [];
        if (email) {
            mappingEntries.push({
                identifier: email,
                societyId,
                userId: tenantUser._id,
                roleKeys: [ROLES.RESIDENT_TENANT],
                flatId: data.flatId,
            });
        }
        if (mobile && mobile !== email) {
            mappingEntries.push({
                identifier: mobile,
                societyId,
                userId: tenantUser._id,
                roleKeys: [ROLES.RESIDENT_TENANT],
                flatId: data.flatId,
            });
        }
        if (mappingEntries.length > 0) {
            await UserSocietyMapping.insertMany(mappingEntries, { ordered: false }).catch(() => {});
        }

        // 12. Create InviteToken + send invite email
        let plainToken = null;
        let inviteLink = null;
        try {
            const { plainToken: pt, tokenHash } = InviteToken.generateToken();
            plainToken = pt;
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 24);

            await InviteToken.create({
                tokenHash,
                societyId,
                adminId: tenantUser._id,
                purpose: "tenant",
                expiresAt,
            });

            inviteLink = `${FRONTEND_URL}/activate-account?token=${plainToken}`;

            await emailService.sendInviteEmail({
                to: tenantUser.email,
                recipientName: tenantUser.name || data.fullName,
                roleLabel: "Tenant",
                inviteLink,
            });
        } catch (emailErr) {
            console.error("[TenantRegistration] Invite email/token error:", emailErr.message);
        }

        if (process.env.NODE_ENV === "development") {
            console.log("\n=============================================");
            console.log("=== DEV TENANT INVITE LINK ===");
            console.log(`Tenant: ${data.fullName} (${email})`);
            console.log(`Flat: ${flat.flatNumber}`);
            console.log(`Link: ${inviteLink}`);
            console.log("=============================================\n");
        }

        const tenantUserObj = tenantUser.toObject ? { ...tenantUser.toObject() } : { ...tenantUser };
        delete tenantUserObj.password;

        return {
            registration,
            tenantUser: tenantUserObj,
            ...(process.env.NODE_ENV === "development" && inviteLink ? { inviteLink } : {}),
        };
    }

    /**
     * Return flats eligible for tenant registration (owned by user, currently Vacant).
     */
    async getEligibleFlats(societyId, ownerId) {
        const opsDb = getOperationsConnection();
        const Block = opsDb.model("Block");
        const User = opsDb.model("User");

        const [flats, blockDoc, ownerUser] = await Promise.all([
            TenantRegistrationRepository.findEligibleFlats(societyId, ownerId),
            Block.findOne({ societyId }).lean(),
            User.findById(ownerId).select("name").lean(),
        ]);

        const wingMap = Object.fromEntries(
            (blockDoc?.wings || []).map((w) => [w._id.toString(), w])
        );

        return flats.map((flat) => {
            const wing = flat.blockId ? wingMap[flat.blockId.toString()] : null;
            return {
                _id: flat._id,
                id: flat._id.toString(),
                flatNumber: flat.flatNumber,
                occupancyStatus: flat.occupancyStatus,
                blockId: flat.blockId,
                wing: wing?.name || wing?.code || "Wing",
                wingName: wing?.name || null,
                wingCode: wing?.code || null,
                ownerName: flat.ownerName || ownerUser?.name || "Owner",
                floor: flat.floor,
            };
        });
    }

    /**
     * Return all flats owned by ownerId (or all society flats for admin).
     * Used for the Tenancy History tab dropdown.
     */
    async getOwnerFlats(societyId, ownerId, isAdmin) {
        const opsDb = getOperationsConnection();
        const Block = opsDb.model("Block");
        const User = opsDb.model("User");

        const [flats, blockDoc, ownerUser] = await Promise.all([
            TenantRegistrationRepository.findOwnerFlats(societyId, ownerId, isAdmin),
            Block.findOne({ societyId }).lean(),
            User.findById(ownerId).select("name").lean(),
        ]);

        const wingMap = Object.fromEntries(
            (blockDoc?.wings || []).map((w) => [w._id.toString(), w])
        );

        return flats.map((flat) => {
            const wing = flat.blockId ? wingMap[flat.blockId.toString()] : null;
            return {
                _id: flat._id,
                id: flat._id.toString(),
                flatNumber: flat.flatNumber,
                occupancyStatus: flat.occupancyStatus,
                status: flat.status,
                blockId: flat.blockId,
                wing: wing?.name || wing?.code || "Wing",
                wingName: wing?.name || null,
                wingCode: wing?.code || null,
                ownerName: flat.ownerName || ownerUser?.name || "Owner",
                floor: flat.floor,
            };
        });
    }

    /**
     * List tenants — routes to admin or owner view based on isAdmin flag.
     */
    async getTenants(societyId, ownerId, isAdmin, params) {
        const page = parseInt(params.page, 10) || 1;
        const limit = parseInt(params.limit, 10) || 10;
        const { search, status: statusFilter } = params;

        if (isAdmin) {
            return TenantRegistrationRepository.getAllPaginated(societyId, page, limit, search, statusFilter);
        }
        return TenantRegistrationRepository.getPaginatedByOwner(societyId, ownerId, page, limit, search, statusFilter);
    }

    /**
     * Get a single tenant registration by id.
     */
    async getTenantById(societyId, id, ownerId, isAdmin) {
        const record = await TenantRegistrationRepository.getById(societyId, id);
        if (!record) {
            throw new AppError(TENANT_ERRORS.TENANT_NOT_FOUND, 404);
        }
        if (!isAdmin && record.ownerId.toString() !== ownerId.toString()) {
            throw new AppError(TENANT_ERRORS.FORBIDDEN, 403);
        }
        return record;
    }

    /**
     * Change the status of a tenant registration.
     */
    async changeStatus(societyId, id, status, ownerId, isAdmin) {
        const opsDb = getOperationsConnection();
        const Flat = opsDb.model("Flat");
        const Resident = opsDb.model("Resident");

        const record = await TenantRegistrationRepository.getById(societyId, id);
        if (!record) {
            throw new AppError(TENANT_ERRORS.TENANT_NOT_FOUND, 404);
        }
        if (!isAdmin && record.ownerId.toString() !== ownerId.toString()) {
            throw new AppError(TENANT_ERRORS.FORBIDDEN, 403);
        }

        let moveOutDate = null;

        if (status === "Vacated") {
            moveOutDate = new Date();

            // Update flat: mark Vacant, clear activeTenant + currentTenantRegistrationId
            await Flat.findOneAndUpdate(
                { _id: record.flatId, societyId },
                {
                    $set: {
                        occupancyStatus: "Vacant",
                        status: FLAT_STATUS.VACANT,
                        activeTenant: null,
                        currentTenantRegistrationId: null,
                    },
                },
                { new: true }
            );

            // Deactivate the Resident record for this tenant
            await Resident.findOneAndUpdate(
                { societyId, flatId: record.flatId, userId: record.tenantUserId },
                { $set: { isActive: false, moveOutDate } }
            );
        } else if (status === "Active") {
            await Flat.findOneAndUpdate(
                { _id: record.flatId, societyId },
                {
                    $set: {
                        occupancyStatus: "Tenant Occupied",
                        status: FLAT_STATUS.OCCUPIED,
                        activeTenant: record.tenantUserId,
                        currentTenantRegistrationId: record._id,
                    },
                },
                { new: true }
            );
        }

        return TenantRegistrationRepository.updateStatus(societyId, id, status, moveOutDate);
    }

    /**
     * Get full tenancy history for a flat.
     */
    async getTenantHistory(societyId, flatId, ownerId, isAdmin) {
        if (!isAdmin) {
            const opsDb = getOperationsConnection();
            const Flat = opsDb.model("Flat");
            const Resident = opsDb.model("Resident");
            const TenantRegistration = opsDb.model("TenantRegistration");

            const flat = await Flat.findOne({ _id: flatId, societyId }).lean();
            if (!flat) {
                throw new AppError(TENANT_ERRORS.FLAT_NOT_FOUND, 404);
            }

            const isDirectOwner = flat.primaryOwner && flat.primaryOwner.toString() === ownerId.toString();
            if (!isDirectOwner) {
                const [residentOwner, pastRegistration] = await Promise.all([
                    Resident.findOne({ societyId, flatId, userId: ownerId, residentType: "owner" }).lean(),
                    TenantRegistration.findOne({ societyId, flatId, ownerId }).lean(),
                ]);
                if (!residentOwner && !pastRegistration) {
                    throw new AppError(TENANT_ERRORS.FLAT_NOT_OWNED_BY_USER, 403);
                }
            }
        }

        return TenantRegistrationRepository.getTenantsByFlat(societyId, flatId);
    }

    /**
     * Resend activation invite to a tenant.
     * Owner can only resend for their own flat; admin can resend for any.
     */
    async resendInvite(societyId, registrationId, requesterId, isAdmin) {
        const masterDb = getMasterConnection();
        const opsDb = getOperationsConnection();
        const TenantRegistration = opsDb.model("TenantRegistration");
        const User = opsDb.model("User");
        const InviteToken = masterDb.model("InviteToken");

        const registration = await TenantRegistration.findOne({ _id: registrationId, societyId }).lean();
        if (!registration) {
            throw new AppError(TENANT_ERRORS.TENANT_NOT_FOUND, 404);
        }

        // Owner scope check
        if (!isAdmin && registration.ownerId.toString() !== requesterId.toString()) {
            throw new AppError(TENANT_ERRORS.FLAT_NOT_OWNED, 403);
        }

        // Can only resend if tenant is Active or Inactive (not Vacated)
        if (registration.status === "Vacated") {
            throw new AppError("Cannot resend invite to a vacated tenancy", 400);
        }

        const tenantUser = await User.findById(registration.tenantUserId);
        if (!tenantUser) {
            throw new AppError("Tenant user not found", 404);
        }

        // If the user is already active, their account is already set up
        if (tenantUser.status === "active") {
            throw new AppError("Tenant has already activated their account", 400);
        }

        // Invalidate old tokens for this user
        await InviteToken.updateMany(
            { adminId: tenantUser._id, purpose: "tenant", used: false },
            { $set: { used: true } }
        );

        // Create a fresh token
        const { plainToken, tokenHash } = InviteToken.generateToken();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);

        await InviteToken.create({
            tokenHash,
            societyId,
            adminId: tenantUser._id,
            purpose: "tenant",
            expiresAt,
        });

        const inviteLink = `${FRONTEND_URL}/activate-account?token=${plainToken}`;

        await emailService.sendInviteEmail({
            to: tenantUser.email,
            recipientName: tenantUser.name || registration.fullName,
            roleLabel: "Tenant",
            inviteLink,
        });

        if (process.env.NODE_ENV === "development") {
            console.log("\n=================================================");
            console.log("=== DEV TENANT RESEND INVITE LINK ===");
            console.log(`Tenant: ${tenantUser.name} (${tenantUser.email})`);
            console.log(`Link: ${inviteLink}`);
            console.log("=================================================\n");
        }

        return {
            message: "Invitation resent successfully",
            ...(process.env.NODE_ENV === "development" ? { devInviteLink: inviteLink } : {}),
        };
    }
}

module.exports = new TenantRegistrationService();
