const puppeteer = require("puppeteer");
const { config } = require("../config/config");
const logger = require("./logger");
const {
  isAlreadyApplied,
  saveApplication,
  getTodayApplicationCount,
} = require("./database");

function randomDelay() {
  const ms =
    Math.floor(Math.random() * (config.delays.maxDelay - config.delays.minDelay)) +
    config.delays.minDelay;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractJobIdFromUrl(url) {
  // Naukri job URLs contain a job ID, e.g. /job-listings-...-123456
  const match = url.match(/(\d{5,})/) || [];
  return match[1] || url;
}

class NaukriAutomation {
  constructor() {
    this.browser = null;
    this.page = null;
    this.appliedCount = 0;
    this.errors = [];
    this.sessionApplications = [];
  }

  async launch() {
    logger.info("Launching browser...");
    this.browser = await puppeteer.launch({
      headless: config.browser.headless ? "new" : false,
      args: config.browser.args,
      defaultViewport: config.browser.defaultViewport,
    });
    this.page = await this.browser.newPage();
    await this.page.setUserAgent(config.browser.userAgent);

    // Mask webdriver detection
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

    logger.info("Browser launched successfully");
  }

  async login() {
    logger.info("Navigating to Naukri login page...");
    await this.page.goto(config.naukri.loginUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    await sleep(config.delays.pageLoadWait);

    // Check for captcha
    const captchaPresent = await this.page.evaluate(() => {
      const body = document.body.innerText.toLowerCase();
      return (
        body.includes("captcha") ||
        !!document.querySelector('[class*="captcha"]') ||
        !!document.querySelector("iframe[src*='captcha']") ||
        !!document.querySelector("iframe[src*='recaptcha']")
      );
    });

    if (captchaPresent) {
      const msg = "CAPTCHA detected on login page — aborting";
      logger.error(msg);
      this.errors.push(msg);
      throw new Error(msg);
    }

    // Fill credentials
    logger.info("Entering credentials...");
    const emailSelector = 'input[placeholder*="Email" i], input[type="email"], #usernameField';
    const passwordSelector = 'input[type="password"], #passwordField';

    await this.page.waitForSelector(emailSelector, { timeout: 10000 });
    await this.page.click(emailSelector, { clickCount: 3 });
    await this.page.type(emailSelector, config.naukri.email, { delay: 80 });

    await randomDelay();

    await this.page.waitForSelector(passwordSelector, { timeout: 10000 });
    await this.page.click(passwordSelector, { clickCount: 3 });
    await this.page.type(passwordSelector, config.naukri.password, { delay: 80 });

    await randomDelay();

    // Click login button
    const loginBtnSelector =
      'button[type="submit"], button:has-text("Login"), .loginButton, button.btn-primary';
    await this.page.click(loginBtnSelector);
    logger.info("Login button clicked, waiting for navigation...");

    await sleep(config.delays.afterLogin);

    // Verify login success
    const loginFailed = await this.page.evaluate(() => {
      const body = document.body.innerText.toLowerCase();
      return (
        body.includes("invalid email") ||
        body.includes("incorrect password") ||
        body.includes("login failed") ||
        body.includes("your password is incorrect")
      );
    });

    if (loginFailed) {
      const msg = "Login failed — check credentials";
      logger.error(msg);
      this.errors.push(msg);
      throw new Error(msg);
    }

    logger.info("Login successful");
  }

  buildSearchUrl(keyword) {
    const encodedKeyword = encodeURIComponent(keyword).replace(/%20/g, "-");
    const expRange = `${config.search.experienceMin}-${config.search.experienceMax}`;
    // Naukri search URL pattern
    return (
      `${config.naukri.baseUrl}/${encodedKeyword}-jobs-in-india` +
      `?experience=${expRange}` +
      `&jobAge=${config.search.postedWithinDays}`
    );
  }

  async searchAndApply(keyword) {
    const dailyCount = getTodayApplicationCount() + this.appliedCount;
    if (dailyCount >= config.search.maxApplicationsPerDay) {
      logger.info(`Daily limit of ${config.search.maxApplicationsPerDay} reached — stopping`);
      return;
    }

    const searchUrl = this.buildSearchUrl(keyword);
    logger.info(`Searching for "${keyword}": ${searchUrl}`);

    await this.page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(config.delays.pageLoadWait);

    // Collect job listing links
    const jobCards = await this.page.evaluate(() => {
      const cards = document.querySelectorAll(
        'article.jobTuple, .jobTupleHeader, [data-job-id], .srp-jobtuple-wrapper, .cust-job-tuple'
      );
      const jobs = [];
      for (const card of cards) {
        const linkEl =
          card.querySelector("a.title, a[class*='title'], a[href*='/job-listings']") ||
          card.querySelector("a");
        const companyEl = card.querySelector(
          ".comp-name, .companyInfo a, [class*='company'], .subTitle"
        );
        if (linkEl) {
          jobs.push({
            title: linkEl.textContent.trim(),
            link: linkEl.href,
            company: companyEl ? companyEl.textContent.trim() : "Unknown",
          });
        }
      }
      return jobs;
    });

    logger.info(`Found ${jobCards.length} job listings for "${keyword}"`);

    for (const job of jobCards) {
      const currentTotal = getTodayApplicationCount() + this.appliedCount;
      if (currentTotal >= config.search.maxApplicationsPerDay) {
        logger.info("Daily application limit reached");
        return;
      }

      const jobId = extractJobIdFromUrl(job.link);

      if (isAlreadyApplied(jobId)) {
        logger.info(`Skipping already-applied job: ${job.title} (${jobId})`);
        continue;
      }

      try {
        await this.applyToJob(job, jobId, keyword);
      } catch (err) {
        const errMsg = `Error applying to "${job.title}" at ${job.company}: ${err.message}`;
        logger.error(errMsg);
        this.errors.push(errMsg);
      }

      await randomDelay();
    }
  }

  async applyToJob(job, jobId, keyword) {
    logger.info(`Opening job: ${job.title} at ${job.company}`);

    // Open job in a new tab
    const jobPage = await this.browser.newPage();
    await jobPage.setUserAgent(config.browser.userAgent);

    try {
      await jobPage.goto(job.link, { waitUntil: "networkidle2", timeout: 30000 });
      await sleep(config.delays.pageLoadWait);

      // Check for captcha on job page
      const hasCaptcha = await jobPage.evaluate(() => {
        return (
          !!document.querySelector("iframe[src*='captcha']") ||
          !!document.querySelector("iframe[src*='recaptcha']")
        );
      });

      if (hasCaptcha) {
        const msg = `CAPTCHA detected on job page: ${job.title} — skipping`;
        logger.warn(msg);
        this.errors.push(msg);
        return;
      }

      // Look for the Apply button
      const applyBtnSelector = [
        "button#apply-button",
        "button.apply-button",
        'button[class*="apply"]',
        'button:has-text("Apply")',
        ".apply-btn",
        "#apply-button",
        'a[class*="apply"]',
      ].join(", ");

      const applyBtn = await jobPage.$(applyBtnSelector);

      if (!applyBtn) {
        // Try text-based search
        const foundApply = await jobPage.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll("button, a"));
          for (const btn of buttons) {
            const text = btn.textContent.trim().toLowerCase();
            if (
              (text === "apply" || text === "apply on company site" || text.includes("apply now")) &&
              !btn.disabled
            ) {
              btn.click();
              return true;
            }
          }
          return false;
        });

        if (!foundApply) {
          logger.info(`No Apply button for: ${job.title} — may already be applied or external`);
          return;
        }
      } else {
        const isDisabled = await jobPage.evaluate(
          (btn) => btn.disabled || btn.classList.contains("applied"),
          applyBtn
        );
        if (isDisabled) {
          logger.info(`Apply button disabled for: ${job.title} — already applied`);
          return;
        }
        await applyBtn.click();
      }

      logger.info(`Clicked Apply for: ${job.title}`);
      await sleep(config.delays.pageLoadWait);

      // Handle any "Apply with Naukri resume" confirmation dialog
      const confirmBtn = await jobPage.$(
        'button:has-text("Apply"), button:has-text("Submit"), .chatbot_applyConfirm'
      );
      if (confirmBtn) {
        await confirmBtn.click();
        await sleep(2000);
      }

      // Save to database
      const saved = saveApplication({
        jobId,
        companyName: job.company,
        jobTitle: job.title,
        jobLink: job.link,
        keywordUsed: keyword,
      });

      if (saved) {
        this.appliedCount++;
        this.sessionApplications.push({
          company_name: job.company,
          job_title: job.title,
          job_link: job.link,
        });
        logger.info(
          `Successfully applied (${this.appliedCount}): ${job.title} at ${job.company}`
        );
      }
    } finally {
      await jobPage.close();
    }
  }

  async run() {
    try {
      await this.launch();
      await this.login();

      for (const keyword of config.search.keywords) {
        const dailyCount = getTodayApplicationCount() + this.appliedCount;
        if (dailyCount >= config.search.maxApplicationsPerDay) {
          logger.info("Daily limit reached — stopping search loop");
          break;
        }

        await this.searchAndApply(keyword);
        await randomDelay();
      }

      logger.info(
        `Session complete. Applied to ${this.appliedCount} jobs today.`
      );
    } finally {
      await this.close();
    }

    return {
      applications: this.sessionApplications,
      errors: this.errors,
      totalApplied: this.appliedCount,
    };
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      logger.info("Browser closed");
    }
  }
}

module.exports = NaukriAutomation;
