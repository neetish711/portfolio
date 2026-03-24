const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const { config } = require("../config/config");
const logger = require("./logger");

let db;

function initDatabase() {
  const dbDir = path.dirname(config.database.path);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(config.database.path);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT UNIQUE,
      company_name TEXT,
      job_title TEXT,
      job_link TEXT,
      date_applied TEXT,
      status TEXT DEFAULT 'Applied',
      platform TEXT DEFAULT 'Naukri',
      keyword_used TEXT
    )
  `);

  logger.info("Database initialized");
  return db;
}

function isAlreadyApplied(jobId) {
  const row = db.prepare("SELECT id FROM applications WHERE job_id = ?").get(jobId);
  return !!row;
}

function saveApplication({ jobId, companyName, jobTitle, jobLink, keywordUsed }) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO applications (job_id, company_name, job_title, job_link, date_applied, status, platform, keyword_used)
    VALUES (?, ?, ?, ?, ?, 'Applied', 'Naukri', ?)
  `);
  const result = stmt.run(
    jobId,
    companyName,
    jobTitle,
    jobLink,
    new Date().toISOString(),
    keywordUsed
  );
  if (result.changes > 0) {
    logger.info(`Saved application: ${jobTitle} at ${companyName}`);
  }
  return result.changes > 0;
}

function getTodayApplicationCount() {
  const today = new Date().toISOString().split("T")[0];
  const row = db
    .prepare(
      "SELECT COUNT(*) as count FROM applications WHERE date_applied LIKE ?"
    )
    .get(`${today}%`);
  return row.count;
}

function getTodayApplications() {
  const today = new Date().toISOString().split("T")[0];
  return db
    .prepare(
      "SELECT company_name, job_title, job_link, date_applied FROM applications WHERE date_applied LIKE ? ORDER BY date_applied DESC"
    )
    .all(`${today}%`);
}

function closeDatabase() {
  if (db) {
    db.close();
    logger.info("Database connection closed");
  }
}

module.exports = {
  initDatabase,
  isAlreadyApplied,
  saveApplication,
  getTodayApplicationCount,
  getTodayApplications,
  closeDatabase,
};
