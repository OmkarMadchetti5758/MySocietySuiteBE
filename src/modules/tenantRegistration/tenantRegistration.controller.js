"use strict";

const TenantRegistrationService = require("./tenantRegistration.service");
const { sendSuccess } = require("../../utils/response.utils");
const { ROLES } = require("../../common/constants");

const ADMIN_ROLES = new Set([ROLES.ADMIN, ROLES.COMMITTEE_MEMBER, ROLES.SUPER_ADMIN]);

const isAdminRole = (user) => {
    if (!user) return false;
    if (ADMIN_ROLES.has(user.role)) return true;
    if (Array.isArray(user.roleKeys) && user.roleKeys.some((r) => ADMIN_ROLES.has(r))) return true;
    return false;
};

class TenantRegistrationController {
    async registerTenant(req, res, next) {
        try {
            const result = await TenantRegistrationService.registerTenant(
                req.societyId,
                req.user.id,
                req.body,
                req.files
            );
            return sendSuccess(res, 201, "Tenant registered successfully", result);
        } catch (error) {
            next(error);
        }
    }

    async getEligibleFlats(req, res, next) {
        try {
            const flats = await TenantRegistrationService.getEligibleFlats(
                req.societyId,
                req.user.id
            );
            return sendSuccess(res, 200, "Eligible flats retrieved successfully", { flats });
        } catch (error) {
            next(error);
        }
    }

    async getOwnerFlats(req, res, next) {
        try {
            const isAdmin = isAdminRole(req.user);
            const flats = await TenantRegistrationService.getOwnerFlats(
                req.societyId,
                req.user.id,
                isAdmin
            );
            return sendSuccess(res, 200, "Owner flats retrieved successfully", { flats });
        } catch (error) {
            next(error);
        }
    }

    async getTenants(req, res, next) {
        try {
            const isAdmin = isAdminRole(req.user);
            const result = await TenantRegistrationService.getTenants(
                req.societyId,
                req.user.id,
                isAdmin,
                req.query
            );
            return sendSuccess(res, 200, "Tenant registrations retrieved successfully", result);
        } catch (error) {
            next(error);
        }
    }

    async getTenantById(req, res, next) {
        try {
            const isAdmin = isAdminRole(req.user);
            const record = await TenantRegistrationService.getTenantById(
                req.societyId,
                req.params.id,
                req.user.id,
                isAdmin
            );
            return sendSuccess(res, 200, "Tenant registration retrieved successfully", { record });
        } catch (error) {
            next(error);
        }
    }

    async changeStatus(req, res, next) {
        try {
            const isAdmin = isAdminRole(req.user);
            const { status } = req.body;
            const record = await TenantRegistrationService.changeStatus(
                req.societyId,
                req.params.id,
                status,
                req.user.id,
                isAdmin
            );
            return sendSuccess(res, 200, "Tenant status updated successfully", { record });
        } catch (error) {
            next(error);
        }
    }

    async getTenantHistory(req, res, next) {
        try {
            const isAdmin = isAdminRole(req.user);
            const history = await TenantRegistrationService.getTenantHistory(
                req.societyId,
                req.params.flatId,
                req.user.id,
                isAdmin
            );
            return sendSuccess(res, 200, "Tenant history retrieved successfully", { history });
        } catch (error) {
            next(error);
        }
    }

    async resendInvite(req, res, next) {
        try {
            const isAdmin = isAdminRole(req.user);
            const result = await TenantRegistrationService.resendInvite(
                req.societyId,
                req.params.id,
                req.user.id,
                isAdmin
            );
            return sendSuccess(res, 200, "Invitation resent successfully", result);
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new TenantRegistrationController();
