"use strict";

const multer = require("multer");
const path = require("path");
const AppError = require("../common/AppError");

const excelUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB max
    },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname || "").toLowerCase();
        if (ext !== ".xlsx") {
            return cb(new AppError("Only Excel (.xlsx) files are allowed.", 400), false);
        }
        cb(null, true);
    },
});

module.exports = excelUpload;
