const jwt = require("jsonwebtoken");
const User = require("../models/User.model");

// Protect routes — verify JWT access token
const protect = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Access denied. No token provided.",
            });
        }

        const token = authHeader.split(" ")[1];

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch {
            return res.status(401).json({
                success: false,
                message: "Invalid or expired access token",
            });
        }

        const user = await User.findById(decoded.id);
        if (!user || !user.isActive) {
            return res.status(401).json({
                success: false,
                message: "User not found or deactivated",
            });
        }

        req.user = user;
        next();
    } catch (error) {
        next(error);
    }
};

// Restrict to specific roles
const restrictTo = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `Access denied. Requires role: ${roles.join(" or ")}`,
            });
        }
        next();
    };
};

module.exports = { protect, restrictTo };
