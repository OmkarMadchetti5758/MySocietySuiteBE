"use strict";

const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { TOKEN_TYPE } = require("../common/constants");

/**
 * Generate Access Token
 */
const generateAccessToken = (payload) => {
    return jwt.sign(
        { ...payload, type: TOKEN_TYPE.ACCESS },
        env.JWT_SECRET,
        { expiresIn: env.JWT_ACCESS_EXPIRES_IN }
    );
};

/**
 * Generate Refresh Token
 */
const generateRefreshToken = (payload) => {
    return jwt.sign(
        { ...payload, type: TOKEN_TYPE.REFRESH },
        env.JWT_REFRESH_SECRET,
        { expiresIn: env.JWT_REFRESH_EXPIRES_IN }
    );
};

/**
 * Verify Token (Access or Refresh)
 */
const verifyToken = (token, isRefresh = false) => {
    const secret = isRefresh ? env.JWT_REFRESH_SECRET : env.JWT_SECRET;
    return jwt.verify(token, secret);
};

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    verifyToken
};
