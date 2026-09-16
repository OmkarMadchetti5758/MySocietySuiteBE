"use strict";

const { Server } = require("socket.io");
const { logger } = require("../middleware/logger");

let io;

/**
 * Initialize Socket.IO server
 * @param {Object} server - HTTP Server instance
 */
const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: "*", // allow all origins or restrict to FE origin
            methods: ["GET", "POST"],
        },
    });

    io.on("connection", (socket) => {
        logger.info(`🔌 Socket connected: ${socket.id}`);

        // Automatically join rooms from handshake query if provided
        const { userId, role, gateId, entryId } = socket.handshake.query || {};
        if (gateId) {
            socket.join(`gate_${gateId}`);
            logger.info(`Socket ${socket.id} auto-joined gate room: gate_${gateId}`);
        }
        if (role === 'gate' && userId) {
            socket.join(`gate_${userId}`);
            logger.info(`Socket ${socket.id} auto-joined gate room: gate_${userId}`);
        }
        if (userId) {
            socket.join(`user_${userId}`);
            logger.info(`Socket ${socket.id} auto-joined user room: user_${userId}`);
        }
        if (entryId) {
            socket.join(`entry_${entryId}`);
            logger.info(`Socket ${socket.id} auto-joined entry room: entry_${entryId}`);
        }

        // Join a specific room based on gateId, userId, or entryId
        socket.on("join-gate", (gId) => {
            if (gId) {
                socket.join(`gate_${gId}`);
                logger.info(`Socket ${socket.id} joined gate room: gate_${gId}`);
            }
        });

        socket.on("join-user", (uId) => {
            if (uId) {
                socket.join(`user_${uId}`);
                logger.info(`Socket ${socket.id} joined user room: user_${uId}`);
            }
        });

        socket.on("join-entry", (eId) => {
            if (eId) {
                socket.join(`entry_${eId}`);
                logger.info(`Socket ${socket.id} joined entry room: entry_${eId}`);
            }
        });

        socket.on("disconnect", () => {
            logger.info(`🛑 Socket disconnected: ${socket.id}`);
        });
    });

    return io;
};

/**
 * Get initialized Socket.IO instance
 */
const getIO = () => {
    if (!io) {
        throw new Error("Socket.io not initialized!");
    }
    return io;
};

module.exports = {
    initSocket,
    getIO,
};
