"use strict";

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { morganMiddleware } = require("./middleware/logger");
const notFound = require("./middleware/notFound");
const errorHandler = require("./middleware/errorHandler");
const v1Routes = require("./routes/v1");

const app = express();

// Disable ETag — prevents 304 "Not Modified" responses on dynamic API data
app.set("etag", false);

// Security HTTP headers
app.use(helmet());

// Enable CORS
app.use(cors());

// Request logging (Winston + Morgan)
app.use(morganMiddleware);

// Body parsing
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

// Prevent caching for all API routes
app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});

// Serve static files
const path = require("path");
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// API Versioning - mount v1 routes
app.use("/api/v1", v1Routes);

// Handle undefined routes
app.use(notFound);

// Global Error Handler
app.use(errorHandler);

module.exports = app;