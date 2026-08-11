"use strict";

const express = require("express");
const authRoutes = require("../../modules/auth/auth.routes");
const userRoutes = require("../../modules/user/user.routes");
const societyRoutes = require("../../modules/society/society.routes");
const { sendSuccess } = require("../../utils/response.utils");

const router = express.Router();

// Health Check API
router.get("/health", (req, res) => {
    return sendSuccess(res, 200, "API is running normally", {
        uptime: process.uptime(),
        timestamp: new Date()
    });
});

// Module Routes
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/societies", societyRoutes);
router.use("/super-admin", require("../../modules/superAdmin/superAdmin.routes"));

// Mount other module routes here as they are developed
// router.use("/societies", societyRoutes);
// router.use("/blocks", blockRoutes);
// ...

module.exports = router;
