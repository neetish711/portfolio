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
      userDataDir: config.browser.userDataDir,
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
    if (config.naukri.loginMethod === "gmail-sso") {
      await this.loginWithGmailSSO();
    } else {
      await this.loginWithEmailPassword();
    }
  }

  async checkForCaptcha(page) {
    const captchaPresent = await page.evaluate(() => {
      const body = document.body.innerText.toLowerCase();
      return (
        body.includes("captcha") ||
        !!document.querySelector('[class*="captcha"]') ||
        !!document.querySelector("iframe[src*='captcha']") ||
        !!document.querySelector("iframe[src*='recaptcha']")
      );
    });
    if (captchaPresent) {
      const msg = "CAPTCHA detected — aborting";
      logger.error(msg);
      this.errors.push(msg);
      throw new Error(msg);
    }
  }

  async verifyLoginSuccess() {
    // Check if we're on the Naukri homepage/dashboard (logged-in state)
    await sleep(config.delays.afterLogin);

    const isLoggedIn = await this.page.evaluate(() => {
      // Naukri shows user menu / profile icon when logged in
      return (
        !!document.querySelector('[class*="nI-gNb-drawer"]') ||
        !!document.querySelector('[class*="user-name"]') ||
        !!document.querySelector('.nI-gNb-header__right .nI-gNb-icon') ||
        !!document.querySelector('[class*="profile"]') ||
        document.cookie.includes("nauk_at") ||
        !document.querySelector('a[href*="login"]')
      );
    });

    if (!isLoggedIn) {
      // Also check by navigating to profile
      const currentUrl = this.page.url();
      if (
        currentUrl.includes("naukri.com") &&
        !currentUrl.includes("login") &&
        !currentUrl.includes("nlogin")
      ) {
        logger.info("Login appears successful (redirected away from login page)");
        return;
      }

      const msg = "Login verification failed — could not confirm logged-in state";
      logger.error(msg);
      this.errors.push(msg);
      throw new Error(msg);
    }

    logger.info("Login verified successfully");
  }

  async loginWithGmailSSO() {
    logger.info("Logging in via Gmail SSO...");
    await this.page.goto(config.naukri.loginUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    await sleep(config.delays.pageLoadWait);
    await this.checkForCaptcha(this.page);

    // Check if already logged in (persisted session from userDataDir)
    const alreadyLoggedIn = await this.page.evaluate(() => {
      return (
        !!document.querySelector('[class*="nI-gNb-drawer"]') ||
        !!document.querySelector('[class*="user-name"]')
      );
    });
    const currentUrl = this.page.url();
    if (
      alreadyLoggedIn ||
      (currentUrl.includes("naukri.com") &&
        !currentUrl.includes("login") &&
        !currentUrl.includes("nlogin"))
    ) {
      logger.info("Already logged in from previous session (persisted profile)");
      return;
    }

    // Set up popup listener BEFORE clicking Google button
    const googlePopupPromise = new Promise((resolve) => {
      this.browser.once("targetcreated", async (target) => {
        const popup = await target.page();
        resolve(popup);
      });
    });

    // Click the "Login with Google" / "Google" button on Naukri
    logger.info("Clicking Google SSO button...");
    const googleBtnClicked = await this.page.evaluate(() => {
      // Naukri uses various selectors for the Google login button
      const selectors = [
        'button[class*="google"]',
        'a[class*="google"]',
        'div[class*="google"]',
        'button[class*="Google"]',
        'a[class*="Google"]',
        ".google-login-btn",
        '[data-login-type="google"]',
        'button[aria-label*="Google"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          el.click();
          return true;
        }
      }
      // Fallback: find by text content
      const allBtns = document.querySelectorAll("button, a, div[role='button']");
      for (const btn of allBtns) {
        const text = btn.textContent.trim().toLowerCase();
        if (text.includes("google") && (text.includes("login") || text.includes("sign in") || text.includes("continue"))) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (!googleBtnClicked) {
      const msg = "Could not find Google SSO button on Naukri login page";
      logger.error(msg);
      this.errors.push(msg);
      throw new Error(msg);
    }

    logger.info("Waiting for Google OAuth popup...");

    // Wait for the Google popup to appear (with timeout)
    const googlePopup = await Promise.race([
      googlePopupPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Google popup did not appear within 15s")), 15000)
      ),
    ]);

    if (!googlePopup) {
      throw new Error("Google OAuth popup failed to open");
    }

    await sleep(config.delays.pageLoadWait);

    // Enter Google email
    logger.info("Entering Google email...");
    const emailInput = await googlePopup.waitForSelector(
      'input[type="email"], input#identifierId',
      { timeout: 15000 }
    );
    await emailInput.click({ clickCount: 3 });
    await emailInput.type(config.google.email, { delay: 70 });
    await randomDelay();

    // Click Next
    const nextBtn1 = await googlePopup.$("#identifierNext, button:has-text('Next')");
    if (nextBtn1) {
      await nextBtn1.click();
    } else {
      await googlePopup.evaluate(() => {
        const btns = document.querySelectorAll("button");
        for (const b of btns) {
          if (b.textContent.trim().toLowerCase() === "next") {
            b.click();
            break;
          }
        }
      });
    }

    await sleep(config.delays.pageLoadWait + 2000);

    // Check for CAPTCHA on Google page
    await this.checkForCaptcha(googlePopup);

    // Enter Google password
    logger.info("Entering Google password...");
    const passwordInput = await googlePopup.waitForSelector(
      'input[type="password"], input[name="Passwd"]',
      { timeout: 15000 }
    );
    await passwordInput.click({ clickCount: 3 });
    await passwordInput.type(config.google.password, { delay: 70 });
    await randomDelay();

    // Click Next
    const nextBtn2 = await googlePopup.$("#passwordNext, button:has-text('Next')");
    if (nextBtn2) {
      await nextBtn2.click();
    } else {
      await googlePopup.evaluate(() => {
        const btns = document.querySelectorAll("button");
        for (const b of btns) {
          if (b.textContent.trim().toLowerCase() === "next") {
            b.click();
            break;
          }
        }
      });
    }

    logger.info("Google credentials submitted, waiting for redirect...");
    await sleep(config.delays.afterLogin + 3000);

    // The popup should close and Naukri should now be logged in
    // Wait for the main page to reflect login
    await this.page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {
      // Navigation may have already completed
    });

    await this.verifyLoginSuccess();
    logger.info("Gmail SSO login successful");
  }

  async loginWithEmailPassword() {
    logger.info("Logging in with email/password...");
    await this.page.goto(config.naukri.loginUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    await sleep(config.delays.pageLoadWait);
    await this.checkForCaptcha(this.page);

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

    logger.info("Email/password login successful");
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
