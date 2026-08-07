"use strict";

const userSchema = require("./user.model");

class UserRepository {
    _getModel(tenantDb) {
        if (!tenantDb.models.User) {
            tenantDb.model("User", userSchema);
        }
        return tenantDb.model("User");
    }

    async create(tenantDb, userData) {
        const User = this._getModel(tenantDb);
        return User.create(userData);
    }

    // Alias for create — used by SocietyService during tenant provisioning
    async createUser(tenantDb, userData) {
        return this.create(tenantDb, userData);
    }

    async findById(tenantDb, userId) {
        const User = this._getModel(tenantDb);
        return User.findById(userId);
    }

    async findByEmailOrMobile(tenantDb, email, mobile) {
        const User = this._getModel(tenantDb);
        const query = [];
        if (email) query.push({ email });
        if (mobile) query.push({ mobile });
        
        if (query.length === 0) return null;

        return User.findOne({ $or: query });
    }

    async findAll(tenantDb, filter = {}, skip = 0, limit = 10) {
        const User = this._getModel(tenantDb);
        const [users, total] = await Promise.all([
            User.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
            User.countDocuments(filter)
        ]);
        return { users, total };
    }

    async update(tenantDb, userId, updateData) {
        const User = this._getModel(tenantDb);
        return User.findByIdAndUpdate(userId, updateData, { new: true, runValidators: true });
    }

    async delete(tenantDb, userId) {
        const User = this._getModel(tenantDb);
        return User.findByIdAndDelete(userId);
    }
}

module.exports = new UserRepository();
