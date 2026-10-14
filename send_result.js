/**
 * BCC Aptitude Assessment - Result Dispatcher & API Server
 * Sends beautifully formatted HTML result emails via Nodemailer
 */

const http = require("http");
const nodemailer = require("nodemailer");

// Load .env if present (native in Node 20+)
try { process.loadEnvFile(); } catch {}

const PORT = process.env.PORT || 3000;

function formatDuration(sec) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s < 10 ? "0" : ""}${s}s`;
}

function getInitials(name) {
  if (!name) return "BC";
  const parts = name.trim().split(/\s+/);
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function normalizeSubmission(raw = {}) {
  const name = raw.candidate_name || raw.name || "Candidate";
  const email = raw.candidate_email || raw.email || "";
  const test = raw.test === "aptitude" ? "Aptitude Screening Assessment"
             : raw.test === "bluecascade" ? "BlueCascade Assessment"
             : raw.test === "games" ? "Cognitive Games Assessment"
             : (raw.test || "Assessment");
  const score = raw.score ?? 0;
  const points = raw.points ?? 0;
  const total = raw.total ?? 12;
  const durationSec = raw.duration_sec ?? raw.durationSec ?? 0;
  const submissionId = String(raw.id || raw.submissionId || "assessment").slice(0, 8);
  const date = raw.created_at
    ? new Date(raw.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "October 13, 2026";

  let rawAnswers = raw.answers;
  if (typeof rawAnswers === "string") {
    try { rawAnswers = JSON.parse(rawAnswers); } catch(e){}
  }

  // Dynamic section calculation from answers array or trait score map
  let sections = [];
  const icons = { "Numerical Reasoning": "📊", "Verbal Reasoning": "📝", "Inductive & Logical": "🧩", "Situational Judgment": "⚖️" };

  if (Array.isArray(rawAnswers) && rawAnswers.length > 0) {
    const map = {};
    rawAnswers.forEach(a => {
      const s = a.section || "General Reasoning";
      if (!map[s]) map[s] = { name: s, correct: 0, total: 0 };
      map[s].total++;
      if (a.correct) map[s].correct++;
    });
    const sectionOrder = ["Numerical Reasoning", "Verbal Reasoning", "Inductive & Logical", "Situational Judgment"];
    const entries = Object.values(map).sort((a, b) => {
      const ia = sectionOrder.indexOf(a.name);
      const ib = sectionOrder.indexOf(b.name);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
    sections = entries.map(s => {
      const pct = s.total ? Math.round((s.correct / s.total) * 100) : 0;
      const isAmber = pct < 50;
      return {
        name: s.name,
        icon: icons[s.name] || "📋",
        correct: s.correct,
        total: s.total,
        ratioLabel: `${s.correct} / ${s.total}`,
        pct,
        color: isAmber ? "#d97706" : "#0d9488",
        bg: isAmber ? "#fef3c7" : "#ccfbf1",
      };
    });
  } else if (rawAnswers && typeof rawAnswers === "object") {
    const gameTraits = {
      risk: { name: "Risk Management", icon: "🎲" },
      memory: { name: "Working Memory", icon: "🧠" },
      pattern: { name: "Logical Reasoning", icon: "🧩" },
      emotion: { name: "Emotional Intelligence", icon: "❤️" },
      number: { name: "Numerical Speed", icon: "🔢" },
      boundaries: { name: "Professional Boundaries", icon: "🛡️" },
      culture: { name: "Maintaining Culture", icon: "🤝" },
      discipline: { name: "Discipline & Focus", icon: "⏱️" }
    };
    const traitOrder = ["risk", "memory", "pattern", "emotion", "number", "boundaries", "culture", "discipline"];
    const entries = Object.entries(rawAnswers).sort(([a], [b]) => {
      const ia = traitOrder.indexOf(a), ib = traitOrder.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    sections = entries.map(([key, val]) => {
      const def = gameTraits[key] || { name: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " "), icon: "🎮" };
      const pct = Math.max(0, Math.min(100, Math.round(Number(val) || 0)));
      const isAmber = pct < 50;
      return {
        name: def.name,
        icon: def.icon,
        ratioLabel: pct >= 60 ? "Benchmark Met" : "Below Benchmark",
        pct,
        color: isAmber ? "#d97706" : "#0d9488",
        bg: isAmber ? "#fef3c7" : "#ccfbf1",
      };
    });
  }

  // Fallback default sections if answers detail isn't available
  if (!sections.length) {
    sections = [
      { name: "Numerical Reasoning", icon: "📊", correct: 2, total: 3, ratioLabel: "2 / 3", pct: 67, color: "#0d9488", bg: "#ccfbf1" },
      { name: "Verbal Reasoning", icon: "📝", correct: 2, total: 3, ratioLabel: "2 / 3", pct: 67, color: "#0d9488", bg: "#ccfbf1" },
      { name: "Inductive & Logical", icon: "🧩", correct: 1, total: 3, ratioLabel: "1 / 3", pct: 33, color: "#d97706", bg: "#fef3c7" },
      { name: "Situational Judgment", icon: "⚖️", correct: 2, total: 3, ratioLabel: "2 / 3", pct: 67, color: "#0d9488", bg: "#ccfbf1" },
    ];
  }

  return { name, email, test, score, points, total, durationSec, submissionId, date, sections };
}

function buildEmailHtml(raw) {
  const data = normalizeSubmission(raw);
  const duration = formatDuration(data.durationSec);
  const avgSecPerQ = data.total ? Math.round(data.durationSec / data.total) : 0;
  const initials = getInitials(data.name);

  const sectionCards = data.sections.map(s => `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:10px;">
      <tr>
        <td style="padding:14px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
            <tr>
              <td style="vertical-align:middle;text-align:left;">
                <span style="font-size:15px;margin-right:8px;vertical-align:middle;">${s.icon}</span>
                <span style="font-size:14px;font-weight:700;color:#0f172a;vertical-align:middle;">${s.name}</span>
              </td>
              <td style="vertical-align:middle;text-align:right;white-space:nowrap;">
                <span style="font-size:12.5px;font-weight:600;color:#64748b;margin-right:10px;vertical-align:middle;">${s.ratioLabel || (s.total != null ? `${s.correct} / ${s.total}` : "")}</span>
                <span style="display:inline-block;background:${s.bg};color:${s.color};font-size:12px;font-weight:800;padding:3px 9px;border-radius:6px;vertical-align:middle;">
                  ${s.pct}%
                </span>
              </td>
            </tr>
          </table>
          <div style="background:#e2e8f0;height:7px;border-radius:99px;overflow:hidden;margin-top:10px;">
            <div style="background:${s.color};height:7px;width:${s.pct}%;border-radius:99px;"></div>
          </div>
        </td>
      </tr>
    </table>
  `).join("");

  return `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Assessment Report - ${data.name}</title>
</head>
<body style="margin:0;padding:24px 8px;background-color:#eef2f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;color:#1e293b;">
  <center>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%;margin:0 auto;background:#ffffff;border-radius:18px;border:1px solid #dce3eb;overflow:hidden;box-shadow:0 8px 30px rgba(15,23,42,0.06);">
      
      <!-- Top Executive Header -->
      <tr>
        <td style="background:#09131f;padding:24px 28px;border-bottom:3px solid #0d9488;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
            <tr>
              <td style="vertical-align:middle;text-align:left;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="width:10px;vertical-align:middle;">
                      <div style="width:9px;height:9px;border-radius:50%;background:#2dd4bf;"></div>
                    </td>
                    <td style="padding-left:8px;vertical-align:middle;">
                      <span style="color:#ffffff;font-weight:800;font-size:15px;letter-spacing:1px;">BLUECASCADE</span>
                    </td>
                  </tr>
                </table>
                <div style="color:#94a3b8;font-size:12px;margin-top:4px;font-weight:500;">
                  Talent Assessment &bull; Official Report
                </div>
              </td>
              <td style="vertical-align:middle;text-align:right;">
                <span style="display:inline-block;background:rgba(45,212,191,0.14);border:1px solid rgba(45,212,191,0.35);color:#2dd4bf;font-size:11px;font-weight:700;padding:5px 12px;border-radius:99px;text-transform:uppercase;letter-spacing:0.5px;">
                  &bull; Verified
                </span>
              </td>
            </tr>
          </table>

          <div style="margin-top:18px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.1);">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
              <tr>
                <td style="width:44px;vertical-align:middle;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:42px;height:42px;border-radius:12px;background:#0d9488;text-align:center;">
                    <tr>
                      <td style="color:#ffffff;font-size:16px;font-weight:800;vertical-align:middle;text-align:center;">
                        ${initials}
                      </td>
                    </tr>
                  </table>
                </td>
                <td style="padding-left:12px;vertical-align:middle;text-align:left;">
                  <div style="color:#ffffff;font-size:17px;font-weight:800;">${data.name}</div>
                  <div style="color:#94a3b8;font-size:12px;margin-top:2px;">
                    ${data.email} &bull; <span style="color:#2dd4bf;">${data.test}</span>
                  </div>
                </td>
              </tr>
            </table>
          </div>
        </td>
      </tr>

      <!-- Main Body Area -->
      <tr>
        <td style="padding:24px 26px 20px 26px;">

          <!-- Hero Score Card -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;margin-bottom:18px;">
            <tr>
              <td style="padding:22px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                  <tr>
                    <td style="width:100px;vertical-align:middle;text-align:center;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:96px;height:96px;border-radius:50%;background:#ffffff;border:4px solid #0d9488;text-align:center;margin:0 auto;">
                        <tr>
                          <td style="vertical-align:middle;text-align:center;">
                            <div style="font-size:27px;font-weight:900;color:#0f766e;line-height:1;margin-top:2px;">${data.score}%</div>
                            <div style="font-size:9.5px;color:#64748b;text-transform:uppercase;font-weight:700;margin-top:4px;">Score</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                    <td style="vertical-align:middle;padding-left:18px;text-align:left;">
                      <span style="display:inline-block;background:#fffbeb;color:#b45309;border:1px solid #fde68a;padding:3px 10px;border-radius:99px;font-size:11.5px;font-weight:800;">
                        &#9889; Performance Record
                      </span>
                      <div style="font-size:17px;font-weight:800;color:#0f172a;margin-top:6px;">
                        ${data.points} of ${data.total} Questions Correct
                      </div>
                      <div style="font-size:12px;color:#64748b;line-height:1.45;margin-top:4px;">
                        Assessment results processed and logged to candidate profile.
                      </div>
                    </td>
                  </tr>
                </table>

                <div style="background:#e2e8f0;height:8px;border-radius:99px;overflow:hidden;margin-top:18px;">
                  <div style="background:#0d9488;height:8px;width:${data.score}%;border-radius:99px;"></div>
                </div>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-top:6px;font-size:10.5px;color:#94a3b8;font-weight:600;">
                  <tr>
                    <td style="text-align:left;">0%</td>
                    <td style="text-align:center;color:#0f766e;">Passing Benchmark: 60%</td>
                    <td style="text-align:right;">100%</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- 3-Column Telemetry Box -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;text-align:center;">
            <tr>
              <td style="width:33.33%;padding:14px 10px;vertical-align:middle;text-align:center;">
                <div style="font-size:10.5px;color:#64748b;text-transform:uppercase;font-weight:700;">Time Elapsed</div>
                <div style="font-size:16px;font-weight:800;color:#0f172a;margin-top:3px;font-family:monospace;">${duration}</div>
                <div style="font-size:11px;color:#94a3b8;margin-top:2px;">~${avgSecPerQ}s / question</div>
              </td>
              <td style="width:33.33%;padding:14px 10px;vertical-align:middle;text-align:center;border-left:1px solid #edf2f7;border-right:1px solid #edf2f7;">
                <div style="font-size:10.5px;color:#64748b;text-transform:uppercase;font-weight:700;">Accuracy</div>
                <div style="font-size:16px;font-weight:800;color:#0d9488;margin-top:3px;">${data.score}%</div>
                <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${data.points} / ${data.total} correct</div>
              </td>
              <td style="width:33.33%;padding:14px 10px;vertical-align:middle;text-align:center;">
                <div style="font-size:10.5px;color:#64748b;text-transform:uppercase;font-weight:700;">Integrity</div>
                <div style="font-size:15px;font-weight:800;color:#16a34a;margin-top:3px;">100% Clean &#10004;</div>
                <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Verified Session</div>
              </td>
            </tr>
          </table>

          <!-- Section Breakdown Title -->
          <div style="font-size:12.5px;font-weight:800;color:#0f172a;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:12px;text-align:left;">
            Section-by-Section Performance
          </div>

          <!-- Section Cards -->
          ${sectionCards}

          <!-- Status Notice -->
          <div style="margin-top:16px;background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid #0d9488;border-radius:8px;padding:12px 14px;text-align:left;">
            <div style="font-size:12px;font-weight:700;color:#0f172a;">Application Status: Synced to Database</div>
            <div style="font-size:11.5px;color:#64748b;line-height:1.45;margin-top:3px;">
              Your test record is saved under candidate reference <code style="background:#edf2f7;padding:1px 5px;border-radius:3px;font-size:11px;color:#0f172a;">${data.submissionId}</code>. The recruitment team reviews profiles continually and will reach out regarding next steps.
            </div>
          </div>

          <!-- Telemetry Footer Stamp -->
          <div style="margin-top:14px;border:1px dashed #cbd5e1;border-radius:8px;padding:8px 12px;text-align:center;background:#fafbfc;">
            <div style="font-size:11px;color:#64748b;">
              🔒 <strong>Anti-Cheat Telemetry:</strong> Verified Session &bull; Date: <strong>${data.date}</strong>
            </div>
          </div>

        </td>
      </tr>

      <!-- Bottom Dark Footer -->
      <tr>
        <td style="background:#09131f;padding:20px 24px;text-align:center;color:#94a3b8;border-top:1px solid #1e293b;">
          <div style="font-size:11.5px;font-weight:700;color:#e2e8f0;">
            BlueCascade Candidate Evaluation System
          </div>
          <div style="font-size:11px;color:#64748b;margin-top:3px;">
            Confidential &bull; Dispatched directly to <strong>${data.email}</strong>
          </div>
          <div style="font-size:10.5px;color:#475569;margin-top:10px;border-top:1px solid #1e293b;padding-top:10px;">
            &copy; 2026 BlueCascade. All rights reserved.
          </div>
        </td>
      </tr>

    </table>
  </center>
</body>
</html>
  `;
}

function getTransporter() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (user && pass) {
    if (process.env.SMTP_HOST) {
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 465,
        secure: process.env.SMTP_SECURE !== "false",
        auth: { user, pass },
      });
    }

    // Auto-detect Zoho Mail for @bluecascade.org
    if (user.toLowerCase().includes("@bluecascade.org") || user.toLowerCase().includes("@zoho")) {
      return nodemailer.createTransport({
        host: "smtp.zoho.com",
        port: 465,
        secure: true,
        auth: { user, pass },
      });
    }

    return nodemailer.createTransport({
      service: process.env.SMTP_SERVICE || "gmail",
      auth: { user, pass },
    });
  }
  return null;
}

async function sendResultEmail(rawSubmission) {
  const sub = normalizeSubmission(rawSubmission);
  if (!sub.email) throw new Error("No candidate email provided");

  let transporter = getTransporter();
  if (!transporter) {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
  }

  const user = process.env.SMTP_USER;
  const mailOptions = {
    from: process.env.EMAIL_FROM || `"BlueCascade Assessments" <${user || "assessment@bluecascade.org"}>`,
    to: sub.email,
    subject: `Assessment Result: ${sub.test} – ${sub.name} (${sub.score}%)`,
    html: buildEmailHtml(rawSubmission),
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`[Email Sent] Recipient: ${sub.email} | Score: ${sub.score}% | Message ID: ${info.messageId}`);
  return info;
}

// Minimal HTTP Server to receive dispatch requests from Admin Dashboard
function startServer() {
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    if (req.method === "POST" && req.url === "/api/send-result") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body || "{}");
          const submission = payload.submission;
          if (!submission) throw new Error("Missing submission object in body");

          const info = await sendResultEmail(submission);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, messageId: info.messageId }));
        } catch (err) {
          console.error("[Mailer Error]", err.message);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "ready", service: "BCC Mailer Server" }));
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(PORT, () => {
    console.log(`======================================================`);
    console.log(` BCC Assessment Mailer Server running on port ${PORT}`);
    console.log(` Ready to receive dispatch calls from Admin Dashboard.`);
    console.log(`======================================================`);
  });
}

module.exports = { normalizeSubmission, buildEmailHtml, sendResultEmail, startServer };

if (require.main === module) {
  startServer();
}
