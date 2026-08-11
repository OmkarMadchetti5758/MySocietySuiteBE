"use strict";

const UserRepository = require("./user.repository");
const AppError = require("../../common/AppError");
const { USER_ERRORS } = require("./user.constants");

/**
 * UserService
 *
 * After migration: societyId is now the first parameter on every method.
 * It is sourced from the authenticated JWT at the controller layer and
 * passed down — never read from request body or query params.
 */
class UserService {
    async createUser(societyId, userData) {
        // Prevent societyId from being overridden via userData input
        delete userData.societyId;

        const existingUser = await UserRepository.findByEmailOrMobile(
            societyId,
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

        const user = await UserRepository.create(societyId, userData);

        const userObj = user.toObject();
        delete userObj.password;

        return userObj;
    }

    async getUserById(societyId, userId) {
        const user = await UserRepository.findById(societyId, userId);
        if (!user) {
            throw new AppError(USER_ERRORS.USER_NOT_FOUND, 404);
        }
        return user;
    }

    async getAllUsers(societyId, filter, skip, limit) {
        return UserRepository.findAll(societyId, filter, skip, limit);
    }

    async updateUser(societyId, userId, updateData) {
        // Prevent client from changing societyId via updateData
        delete updateData.societyId;

        if (updateData.email || updateData.mobile) {
            const existingUser = await UserRepository.findByEmailOrMobile(
                societyId,
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

        const updatedUser = await UserRepository.update(societyId, userId, updateData);
        if (!updatedUser) {
            throw new AppError(USER_ERRORS.USER_NOT_FOUND, 404);
        }
        return updatedUser;
    }

    async deleteUser(societyId, userId) {
        const user = await UserRepository.delete(societyId, userId);
        if (!user) {
            throw new AppError(USER_ERRORS.USER_NOT_FOUND, 404);
        }
        return true;
    }
}

module.exports = new UserService();
