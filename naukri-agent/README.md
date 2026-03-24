# Naukri Job Application Agent

Automated job application agent for Naukri.com built with Node.js and Puppeteer. Runs daily via cron to search for relevant jobs and apply automatically using your stored Naukri resume.

## Features

- **Gmail SSO login** (default) or email/password login
- Persists Chrome session so subsequent runs skip login when possible
- Searches for jobs by configurable keywords
- Filters by location (India), experience (2–5 years), and recency (last 7 days)
- Applies to up to 25 jobs per day with random human-like delays (5–15s)
- Tracks all applications in a local SQLite database to avoid duplicates
- Sends a daily summary email with applied jobs and any errors
- Detects CAPTCHAs and login failures gracefully
- Full logging of all actions

## Project Structure

```
naukri-agent/
├── config/config.js        # All configuration (credentials, search params, delays)
├── src/
│   ├── main.js             # Entry point / agent controller
│   ├── naukri-automation.js # Puppeteer automation for Naukri (login, search, apply)
│   ├── database.js         # SQLite database handler
│   ├── email-sender.js     # Email summary sender
│   └── logger.js           # Winston logger setup
├── scripts/
│   └── setup-cron.js       # Installs the daily cron job
├── .env.example            # Environment variable template
└── package.json
```

## Setup

1. **Install dependencies:**
   ```bash
   cd naukri-agent
   npm install
   ```

2. **Configure credentials:**
   ```bash
   cp .env.example .env
   # Edit .env with your Google/Naukri credentials and email settings
   ```

3. **First run (use visible browser to verify login works):**
   ```bash
   export $(cat .env | xargs) && HEADLESS=false npm start
   ```

4. **Run in headless mode:**
   ```bash
   export $(cat .env | xargs) && npm start
   ```

5. **Install daily cron job (8:00 AM):**
   ```bash
   npm run setup-cron
   ```

## Configuration

All settings are in `config/config.js` and can be overridden via environment variables:

### Login

| Variable | Description |
|---|---|
| `NAUKRI_LOGIN_METHOD` | `gmail-sso` (default) or `email-password` |
| `GOOGLE_EMAIL` | Your Gmail address (for Gmail SSO) |
| `GOOGLE_PASSWORD` | Your Google password (for Gmail SSO) |
| `NAUKRI_EMAIL` | Your Naukri.com login email (for email-password) |
| `NAUKRI_PASSWORD` | Your Naukri.com password (for email-password) |

### Browser & Email

| Variable | Description |
|---|---|
| `HEADLESS` | Set to `false` to see the browser (default: `true`) |
| `EMAIL_SERVICE` | Email service for notifications (default: `gmail`) |
| `EMAIL_USER` | Sender email address |
| `EMAIL_PASSWORD` | Sender email app password |
| `EMAIL_RECIPIENT` | Recipient email for daily summary |

## Search Keywords

Edit `config/config.js` to change the job search keywords:

```js
keywords: [
  "Product Manager",
  "Associate Product Manager",
  "AI Product Manager",
  "Business Analyst",
]
```

## Notes

- **Gmail SSO** is the default login method — the agent clicks "Login with Google" on Naukri, handles the Google OAuth popup, and authenticates with your Gmail credentials
- Chrome profile is persisted at `data/chrome-profile/` so sessions survive across runs
- Uses your **default Naukri resume** — no new upload needed
- If CAPTCHA or login failure is detected, the agent stops and logs the error
- The SQLite database at `data/applications.db` prevents duplicate applications
- For email notifications, use a Gmail [App Password](https://support.google.com/accounts/answer/185833)
