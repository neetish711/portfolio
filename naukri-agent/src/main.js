const { config, validateConfig } = require("../config/config");
const logger = require("./logger");
const { initDatabase, getTodayApplications, closeDatabase } = require("./database");
const NaukriAutomation = require("./naukri-automation");
const { sendSummaryEmail } = require("./email-sender");

async function main() {
  logger.info("=== Naukri Job Application Agent Started ===");

  try {
    validateConfig();
  } catch (err) {
    logger.error(err.message);
    process.exit(1);
  }

  initDatabase();

  const agent = new NaukriAutomation();
  let result;

  try {
    result = await agent.run();
  } catch (err) {
    logger.error(`Agent encountered a fatal error: ${err.message}`);
    result = {
      applications: [],
      errors: [err.message],
      totalApplied: 0,
    };
  }

  // Gather all today's applications (including any from earlier runs)
  const todayApps = getTodayApplications();

  // Send summary email
  await sendSummaryEmail({
    applications: todayApps,
    errors: result.errors,
  });

  closeDatabase();

  logger.info(
    `=== Agent Finished — ${result.totalApplied} new applications, ${result.errors.length} errors ===`
  );
}

main().catch((err) => {
  logger.error(`Unhandled error: ${err.message}`);
  process.exit(1);
});
