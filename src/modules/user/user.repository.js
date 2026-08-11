"use strict";

const { getOperationsConnection } = require("../../config/operationsDb");

/**
 * UserRepository
 *
 * After migration to the shared-collection model, all methods:
 *   - Use getOperationsConnection() instead of a per-tenant DB connection
 *   - Require `societyId` as the first filter parameter — NEVER optional
 *   - Inject societyId into EVERY query so cross-society leakage is impossible
 *
 * SECURITY INVARIANT:
 *   societyId must come from the authenticated JWT (req.user.societyId or req.societyId).
 *   It is never accepted from request body, query params, or route params.
 */
class UserRepository {
    _getModel() {
        return getOperationsConnection().model("User");
    }

    /**
     * Creates a new user document with societyId stamped at the DB layer.
     * The societyId must be validated by the caller (service/controller) before calling this.
     */
    async create(societyId, userData) {
        const User = this._getModel();
        return User.create({ ...userData, societyId });
    }

    // Alias for backward compatibility with SocietyService
    async createUser(societyId, userData) {
        return this.create(societyId, userData);
    }

    async findById(societyId, userId) {
        const User = this._getModel();
        return User.findOne({ _id: userId, societyId });
    }

    async findByEmailOrMobile(societyId, email, mobile) {
        const User = this._getModel();
        const query = [{ societyId }];
        const orConditions = [];
        if (email)  orConditions.push({ email });
        if (mobile) orConditions.push({ mobile });

        if (orConditions.length === 0) return null;

        return User.findOne({ societyId, $or: orConditions });
    }

    async findAll(societyId, filter = {}, skip = 0, limit = 10) {
        const User = this._getModel();
        const scopedFilter = { ...filter, societyId };
        const [users, total] = await Promise.all([
            User.find(scopedFilter).skip(skip).limit(limit).sort({ createdAt: -1 }),
            User.countDocuments(scopedFilter),
        ]);
        return { users, total };
    }

    async update(societyId, userId, updateData) {
        const User = this._getModel();
        // societyId is part of the filter to prevent cross-society update
        return User.findOneAndUpdate(
            { _id: userId, societyId },
            updateData,
            { new: true, runValidators: true }
        );
    }

    async delete(societyId, userId) {
        const User = this._getModel();
        return User.findOneAndDelete({ _id: userId, societyId });
    }
}

module.exports = new UserRepository();
