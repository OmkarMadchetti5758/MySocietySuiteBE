"use strict";

const UserService = require("./user.service");
const { sendSuccess, sendPaginated } = require("../../utils/response.utils");
const { getPaginationOptions, buildPaginationMeta } = require("../../utils/pagination.utils");

class UserController {
    async createUser(req, res, next) {
        try {
            const user = await UserService.createUser(req.tenantDb, req.body);
            return sendSuccess(res, 201, "User created successfully", { user });
        } catch (error) {
            next(error);
        }
    }

    async getUsers(req, res, next) {
        try {
            const { page, limit, skip } = getPaginationOptions(req.query);
            
            // Build simple filter from query
            const filter = {};
            if (req.query.role) filter.role = req.query.role;
            if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';
            
            const { users, total } = await UserService.getAllUsers(req.tenantDb, filter, skip, limit);
            const meta = buildPaginationMeta(total, page, limit);

            return sendPaginated(res, 200, "Users retrieved successfully", users, meta);
        } catch (error) {
            next(error);
        }
    }

    async getUser(req, res, next) {
        try {
            const user = await UserService.getUserById(req.tenantDb, req.params.id);
            return sendSuccess(res, 200, "User retrieved successfully", { user });
        } catch (error) {
            next(error);
        }
    }

    async updateUser(req, res, next) {
        try {
            const user = await UserService.updateUser(req.tenantDb, req.params.id, req.body);
            return sendSuccess(res, 200, "User updated successfully", { user });
        } catch (error) {
            next(error);
        }
    }

    async deleteUser(req, res, next) {
        try {
            await UserService.deleteUser(req.tenantDb, req.params.id);
            return sendSuccess(res, 200, "User deleted successfully");
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new UserController();
