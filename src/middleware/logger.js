"use strict";

const winston = require("winston");
const morgan = require("morgan");
const env = require("../config/env");

const enumerateErrorFormat = winston.format((info) => {
    if (info instanceof Error) {
        Object.assign(info, { message: info.stack });
    }
    return info;
});

const logger = winston.createLogger({
    level: env.NODE_ENV === "development" ? "debug" : "info",
    format: winston.format.combine(
        enumerateErrorFormat(),
        env.NODE_ENV === "development" ? winston.format.colorize() : winston.format.uncolorize(),
        winston.format.splat(),
        winston.format.printf(({ level, message }) => `${level}: ${message}`)
    ),
    transports: [
        new winston.transports.Console({
            stderrLevels: ["error"],
        }),
    ],
});

// Middleware for Morgan to use Winston
const morganMiddleware = morgan(
    env.NODE_ENV === "development" ? "dev" : "combined",
    {
        stream: {
            write: (message) => logger.info(message.trim()),
        },
    }
);

module.exports = { logger, morganMiddleware };
