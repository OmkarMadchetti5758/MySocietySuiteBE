"use strict";

const app = require("./app");
const env = require("./config/env");
const { connectMasterDB } = require("./config/masterDb");
const { connectOperationsDB } = require("./config/operationsDb");
const { logger } = require("./middleware/logger");

const startServer = async () => {
    try {
        // 1. Connect to Master Database (control plane)
        await connectMasterDB();

        // 2. Connect to shared Operations Database (all society operational data)
        await connectOperationsDB();

        // 3. Start Express Server
        const server = app.listen(env.PORT, () => {
            logger.info(`🚀 Server running on http://localhost:${env.PORT}`);
            logger.info(`Environment: ${env.NODE_ENV}`);
        });

        // 3. Graceful Shutdown Handlers
        process.on("unhandledRejection", (err) => {
            logger.error("UNHANDLED REJECTION! 💥 Shutting down...");
            logger.error(err.name, err.message);
            server.close(() => {
                process.exit(1);
            });
        });

        process.on("SIGTERM", () => {
            logger.info("👋 SIGTERM RECEIVED. Shutting down gracefully");
            server.close(() => {
                logger.info("💥 Process terminated!");
            });
        });

    } catch (error) {
        logger.error(`❌ Failed to start server: ${error.message}`);
        process.exit(1);
    }
};

startServer();

process.on("uncaughtException", (err) => {
    console.error("UNCAUGHT EXCEPTION! 💥 Shutting down...");
    console.error(err.name, err.message, err.stack);
    process.exit(1);
});