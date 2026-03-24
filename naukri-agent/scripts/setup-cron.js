const { execSync } = require("child_process");
const path = require("path");

const projectDir = path.resolve(__dirname, "..");
const nodeCmd = process.execPath;
const mainScript = path.join(projectDir, "src", "main.js");

// Cron expression: 8:00 AM every day
const cronExpression = "0 8 * * *";
const cronJob = `${cronExpression} cd ${projectDir} && ${nodeCmd} ${mainScript} >> ${projectDir}/logs/cron.log 2>&1`;

try {
  // Get existing crontab
  let existing = "";
  try {
    existing = execSync("crontab -l 2>/dev/null", { encoding: "utf-8" });
  } catch {
    // No existing crontab
  }

  // Check if job already exists
  if (existing.includes("naukri-agent") || existing.includes(mainScript)) {
    console.log("Cron job already exists. Skipping.");
    process.exit(0);
  }

  // Add marker comment and job
  const newCrontab = `${existing.trimEnd()}\n# naukri-agent: daily job application\n${cronJob}\n`;

  execSync(`echo '${newCrontab.replace(/'/g, "'\\''")}' | crontab -`, {
    encoding: "utf-8",
  });

  console.log("Cron job installed successfully:");
  console.log(`  Schedule: Every day at 8:00 AM`);
  console.log(`  Command:  ${cronJob}`);
} catch (err) {
  console.error(`Failed to set up cron: ${err.message}`);
  process.exit(1);
}
