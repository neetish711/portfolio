const path = require("path");

const config = {
  // Naukri credentials — set via environment variables
  // loginMethod: "gmail-sso" (default) or "email-password"
  naukri: {
    loginMethod: process.env.NAUKRI_LOGIN_METHOD || "gmail-sso",
    email: process.env.NAUKRI_EMAIL || "",
    password: process.env.NAUKRI_PASSWORD || "",
    loginUrl: "https://www.naukri.com/nlogin/login",
    baseUrl: "https://www.naukri.com",
  },

  // Google account credentials (used when loginMethod is "gmail-sso")
  google: {
    email: process.env.GOOGLE_EMAIL || "",
    password: process.env.GOOGLE_PASSWORD || "",
  },

  // Job search parameters
  search: {
    keywords: [
      "Product Manager",
      "Associate Product Manager",
      "AI Product Manager",
      "Business Analyst",
    ],
    location: "India",
    experienceMin: 2,
    experienceMax: 5,
    postedWithinDays: 7,
    maxApplicationsPerDay: 25,
  },

  // Delay settings (milliseconds) to simulate human behavior
  delays: {
    minDelay: 5000,
    maxDelay: 15000,
    pageLoadWait: 3000,
    afterLogin: 5000,
  },

  // Browser settings
  browser: {
    headless: process.env.HEADLESS !== "false",
    // Persist browser profile so Google SSO session survives across runs
    userDataDir: path.join(__dirname, "..", "data", "chrome-profile"),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1366,768",
    ],
    defaultViewport: { width: 1366, height: 768 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },

  // Email notification settings — set via environment variables
  email: {
    service: process.env.EMAIL_SERVICE || "gmail",
    user: process.env.EMAIL_USER || "",
    password: process.env.EMAIL_PASSWORD || "",
    recipient: process.env.EMAIL_RECIPIENT || "",
  },

  // Database
  database: {
    path: path.join(__dirname, "..", "data", "applications.db"),
  },

  // Logging
  logs: {
    dir: path.join(__dirname, "..", "logs"),
  },
};

function validateConfig() {
  const errors = [];

  if (config.naukri.loginMethod === "gmail-sso") {
    if (!config.google.email) errors.push("GOOGLE_EMAIL is not set");
    if (!config.google.password) errors.push("GOOGLE_PASSWORD is not set");
  } else {
    if (!config.naukri.email) errors.push("NAUKRI_EMAIL is not set");
    if (!config.naukri.password) errors.push("NAUKRI_PASSWORD is not set");
  }

  if (errors.length > 0) {
    throw new Error(
      `Configuration errors:\n${errors.map((e) => `  - ${e}`).join("\n")}`
    );
  }
}

module.exports = { config, validateConfig };
