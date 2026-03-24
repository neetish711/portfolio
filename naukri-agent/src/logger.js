const winston = require("winston");
const path = require("path");
const fs = require("fs");
const { config } = require("../config/config");

// Ensure logs directory exists
if (!fs.existsSync(config.logs.dir)) {
  fs.mkdirSync(config.logs.dir, { recursive: true });
}

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.printf(
      ({ timestamp, level, message }) =>
        `[${timestamp}] ${level.toUpperCase()}: ${message}`
    )
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(config.logs.dir, "agent.log"),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(config.logs.dir, "error.log"),
      level: "error",
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
    }),
  ],
});

module.exports = logger;
