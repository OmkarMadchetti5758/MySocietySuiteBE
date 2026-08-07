"use strict";

const UserRepository = require("./user.repository");
const AppError = require("../../common/AppError");
const { USER_ERRORS } = require("./user.constants");

class UserService {
    async createUser(tenantDb, userData) {
        // Check if user already exists
        const existingUser = await UserRepository.findByEmailOrMobile(
            tenantDb,
            userData.email,
            userData.mobile
        );

        if (existingUser) {
            if (existingUser.email === userData.email) {
                throw new AppError(USER_ERRORS.EMAIL_EXISTS, 400);
            }
            if (existingUser.mobile === userData.mobile) {
                throw new AppError(USER_ERRORS.MOBILE_EXISTS, 400);
            }
        }

        const user = await UserRepository.create(tenantDb, userData);
        
        // Remove password from response
        const userObj = user.toObject();
        delete userObj.password;
        
        return userObj;
    }

    async getUserById(tenantDb, userId) {
        const user = await UserRepository.findById(tenantDb, userId);
        if (!user) {
            throw new AppError(USER_ERRORS.USER_NOT_FOUND, 404);
        }
        return user;
    }

    async getAllUsers(tenantDb, filter, skip, limit) {
        return UserRepository.findAll(tenantDb, filter, skip, limit);
    }

    async updateUser(tenantDb, userId, updateData) {
        // If updating email or mobile, ensure it doesn't conflict
        if (updateData.email || updateData.mobile) {
            const existingUser = await UserRepository.findByEmailOrMobile(
                tenantDb,
                updateData.email,
                updateData.mobile
            );

            if (existingUser && existingUser._id.toString() !== userId) {
                if (updateData.email && existingUser.email === updateData.email) {
                    throw new AppError(USER_ERRORS.EMAIL_EXISTS, 400);
                }
                if (updateData.mobile && existingUser.mobile === updateData.mobile) {
                    throw new AppError(USER_ERRORS.MOBILE_EXISTS, 400);
                }
            }
        }

        const updatedUser = await UserRepository.update(tenantDb, userId, updateData);
        if (!updatedUser) {
            throw new AppError(USER_ERRORS.USER_NOT_FOUND, 404);
        }
        return updatedUser;
    }

    async deleteUser(tenantDb, userId) {
        const user = await UserRepository.delete(tenantDb, userId);
        if (!user) {
            throw new AppError(USER_ERRORS.USER_NOT_FOUND, 404);
        }
        return true;
    }
}

module.exports = new UserService();
