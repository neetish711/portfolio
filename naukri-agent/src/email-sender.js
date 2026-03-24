const nodemailer = require("nodemailer");
const { config } = require("../config/config");
const logger = require("./logger");

async function sendSummaryEmail({ applications, errors }) {
  if (!config.email.user || !config.email.password || !config.email.recipient) {
    logger.warn(
      "Email not configured — skipping summary email. Set EMAIL_USER, EMAIL_PASSWORD, and EMAIL_RECIPIENT."
    );
    return;
  }

  const transporter = nodemailer.createTransport({
    service: config.email.service,
    auth: {
      user: config.email.user,
      pass: config.email.password,
    },
  });

  const today = new Date().toISOString().split("T")[0];
  const totalApplied = applications.length;

  let jobRows = "";
  for (const app of applications) {
    jobRows += `<tr>
      <td style="padding:8px;border:1px solid #ddd">${app.company_name}</td>
      <td style="padding:8px;border:1px solid #ddd">${app.job_title}</td>
      <td style="padding:8px;border:1px solid #ddd"><a href="${app.job_link}">View</a></td>
    </tr>`;
  }

  let errorSection = "";
  if (errors.length > 0) {
    errorSection = `
      <h3 style="color:#cc0000">Errors Encountered (${errors.length})</h3>
      <ul>${errors.map((e) => `<li>${e}</li>`).join("")}</ul>
    `;
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
      <h2>Naukri Job Application Summary — ${today}</h2>
      <p><strong>Total Jobs Applied:</strong> ${totalApplied}</p>
      ${
        totalApplied > 0
          ? `<table style="border-collapse:collapse;width:100%">
              <tr style="background:#f4f4f4">
                <th style="padding:8px;border:1px solid #ddd;text-align:left">Company</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left">Job Title</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left">Link</th>
              </tr>
              ${jobRows}
            </table>`
          : "<p>No jobs were applied to today.</p>"
      }
      ${errorSection}
      <hr>
      <p style="color:#888;font-size:12px">Automated by Naukri Job Agent</p>
    </div>
  `;

  const mailOptions = {
    from: config.email.user,
    to: config.email.recipient,
    subject: `Naukri Job Agent Report — ${today} — ${totalApplied} Applications`,
    html,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Summary email sent to ${config.email.recipient}`);
  } catch (err) {
    logger.error(`Failed to send email: ${err.message}`);
  }
}

module.exports = { sendSummaryEmail };
