"use strict";

const AppError = require("../common/AppError");
const { ROLES } = require("../common/constants");

/**
 * injectSocietyId — ensures every request has a valid societyId scope.
 *
 * For normal authenticated users (non-Super Admin):
 *   - Sets req.societyId from req.user.societyId (comes from JWT — never from request body/query)
 *   - Rejects the request if societyId is missing (e.g. a society-less user hitting a tenant endpoint)
 *
 * For Super Admins:
 *   - Allows an optional `x-society-id` header to scope a targeted society action
 *   - If no header, req.societyId remains null — Super Admin endpoints must explicitly
 *     handle the null case (cross-society aggregation allowed, never accidental leakage)
 *
 * Usage: Add this middleware after `authenticate` on all society-scoped routes.
 *
 *   router.use(authenticate, injectSocietyId, checkPermission(...))
 *
 * Repositories then use: { societyId: req.societyId, ...otherFilters }
 *
 * SECURITY INVARIANT:
 *   req.societyId is NEVER sourced from req.body, req.params, or req.query.
 *   It comes exclusively from the authenticated JWT or (for Super Admin) the x-society-id header.
 */
const injectSocietyId = (req, res, next) => {
    const isSuperAdmin = req.user?.role === ROLES.SUPER_ADMIN;

    if (isSuperAdmin) {
        // Super Admin may optionally provide a society scope via header
        // (e.g. when performing a targeted admin action on a specific society)
        const headerSocietyId = req.headers["x-society-id"];
        req.societyId = headerSocietyId || null; // null = platform-wide (no filter)
        return next();
    }

    // All other roles must have societyId from their JWT
    if (!req.user?.societyId) {
        return next(
            new AppError(
                "Request could not be scoped to a society. Please log in with a valid society account.",
                403,
                "MISSING_SOCIETY_CONTEXT"
            )
        );
    }

    req.societyId = req.user.societyId;
    next();
};

module.exports = injectSocietyId;
