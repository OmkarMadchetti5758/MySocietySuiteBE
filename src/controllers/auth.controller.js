const jwt = require("jsonwebtoken");
const User = require("../models/User.model");

// Helper: generate tokens
const generateTokens = (userId) => {
    const accessToken = jwt.sign({ id: userId }, process.env.JWT_SECRET, {
        expiresIn: "60m",
    });
    const refreshToken = jwt.sign({ id: userId }, process.env.REFRESH_TOKEN, {
        expiresIn: "7d",
    });
    return { accessToken, refreshToken };
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res, next) => {
    try {
        const { name, email, password, role } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "Name, email, and password are required",
            });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "User with this email already exists",
            });
        }

        // Create user
        const user = await User.create({ name, email, password, role });

        const { accessToken, refreshToken } = generateTokens(user._id);

        // Save refresh token in DB
        user.refreshToken = refreshToken;
        await user.save({ validateBeforeSave: false });

        res.status(201).json({
            success: true,
            message: "User registered successfully",
            data: {
                user,
                accessToken,
                refreshToken,
            },
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required",
            });
        }

        // Find user and include password field
        const user = await User.findOne({ email }).select("+password");
        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password",
            });
        }

        // Check if user is active
        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: "Your account has been deactivated. Contact admin.",
            });
        }

        // Verify password
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password",
            });
        }

        const { accessToken, refreshToken } = generateTokens(user._id);

        // Save refresh token
        user.refreshToken = refreshToken;
        await user.save({ validateBeforeSave: false });

        res.status(200).json({
            success: true,
            message: "Login successful",
            data: {
                user,
                accessToken,
                refreshToken,
            },
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Refresh access token
// @route   POST /api/auth/refresh-token
// @access  Public (requires valid refresh token)
const refreshAccessToken = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                message: "Refresh token is required",
            });
        }

        // Verify refresh token
        let decoded;
        try {
            decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN);
        } catch {
            return res.status(401).json({
                success: false,
                message: "Invalid or expired refresh token",
            });
        }

        const user = await User.findById(decoded.id).select("+refreshToken");
        if (!user || user.refreshToken !== refreshToken) {
            return res.status(401).json({
                success: false,
                message: "Invalid refresh token",
            });
        }

        const { accessToken, refreshToken: newRefreshToken } = generateTokens(user._id);

        user.refreshToken = newRefreshToken;
        await user.save({ validateBeforeSave: false });

        res.status(200).json({
            success: true,
            message: "Token refreshed",
            data: { accessToken, refreshToken: newRefreshToken },
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
const logout = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        if (user) {
            user.refreshToken = undefined;
            await user.save({ validateBeforeSave: false });
        }

        res.status(200).json({
            success: true,
            message: "Logged out successfully",
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get current logged-in user
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        res.status(200).json({
            success: true,
            data: { user },
        });
    } catch (error) {
        next(error);
    }
};

module.exports = { register, login, refreshAccessToken, logout, getMe };
