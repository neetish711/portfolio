# Naukri Job Application Agent

Automated job application agent for Naukri.com built with Node.js and Puppeteer. Runs daily via cron to search for relevant jobs and apply automatically using your stored Naukri resume.

## Features

- Logs into Naukri.com and searches for jobs by configurable keywords
- Filters by location (India), experience (2–5 years), and recency (last 7 days)
- Applies to up to 25 jobs per day with random human-like delays
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
│   ├── naukri-automation.js # Puppeteer automation for Naukri
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
   # Edit .env with your Naukri credentials and email settings
   ```

3. **Run manually:**
   ```bash
   source .env && npm start
   ```

4. **Install daily cron job (8:00 AM):**
   ```bash
   npm run setup-cron
   ```

## Configuration

All settings are in `config/config.js` and can be overridden via environment variables:

| Variable | Description |
|---|---|
| `NAUKRI_EMAIL` | Your Naukri.com login email |
| `NAUKRI_PASSWORD` | Your Naukri.com password |
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

- Uses your **default Naukri resume** — no new upload needed
- If CAPTCHA or login failure is detected, the agent stops and logs the error
- The SQLite database at `data/applications.db` prevents duplicate applications
- For Gmail notifications, use an [App Password](https://support.google.com/accounts/answer/185833)
