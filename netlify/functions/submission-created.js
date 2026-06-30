/* =====================================================================
   Booking acknowledgement autoresponder
   ---------------------------------------------------------------------
   Runs automatically on EVERY Netlify Form submission (Netlify fires the
   built-in "submission-created" event for any function with this name).

   It emails the CUSTOMER a branded "we got your request" confirmation —
   but ONLY when they filled in the optional email field. Phone is the
   required field, so a customer with no email still gets a text from us;
   they just don't get this email. That's the intended behaviour.

   SAFE TO DEPLOY BEFORE THE DOMAIN/MAILBOX EXIST:
   if the SMTP env vars aren't set yet, the function logs and skips —
   it never breaks a booking (Netlify Forms still captures every one).

   Required Netlify environment variables (set in the Netlify dashboard,
   Site settings -> Environment variables — NEVER commit these):
     SMTP_USER   admin@procare-services.com.au   (the real mailbox login)
     SMTP_PASS   <mailbox password>
   Optional (sensible defaults shown):
     SMTP_HOST   mail.privateemail.com
     SMTP_PORT   465                              (465 = SSL, 587 = STARTTLS)
     ACK_FROM    Pro-Care Appliance Services <no-reply@procare-services.com.au>
     ACK_REPLY_TO  booking@procare-services.com.au  (replies go to a real inbox)
     ACK_BCC     admin@procare-services.com.au    (keep a copy of each ack)
     ACK_BUSINESS_NAME / ACK_BUSINESS_PHONE       (override the defaults below)
   ===================================================================== */

const nodemailer = require("nodemailer");

const BUSINESS_NAME = process.env.ACK_BUSINESS_NAME || "Pro-Care Appliance Services";
const BUSINESS_PHONE = process.env.ACK_BUSINESS_PHONE || "0410 137 427";
const FROM = process.env.ACK_FROM || `${BUSINESS_NAME} <no-reply@procare-services.com.au>`;

exports.handler = async (event) => {
  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: "Bad payload" };
  }

  const payload = body.payload || {};
  const data = payload.data || {};

  // Only handle the booking form (ignore any other forms added later).
  if (payload.form_name && payload.form_name !== "booking") {
    return { statusCode: 200, body: "Ignored (not the booking form)." };
  }

  const email = String(data.email || "").trim();

  // No email supplied → nothing to acknowledge. We'll text the phone instead.
  if (!email) {
    return { statusCode: 200, body: "No email provided — skipped." };
  }

  // Not wired up yet (domain/mailbox not live). Stay dormant rather than error.
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log("Acknowledgement email not configured (SMTP env vars missing) — skipped.");
    return { statusCode: 200, body: "Not configured — skipped." };
  }

  const port = Number(process.env.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "mail.privateemail.com",
    port,
    secure: port === 465, // 465 = implicit SSL, 587 = STARTTLS
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const { subject, html, text } = buildAckEmail(data);

  try {
    await transporter.sendMail({
      from: FROM,
      to: email,
      bcc: process.env.ACK_BCC || undefined,
      replyTo: process.env.ACK_REPLY_TO || undefined,
      subject,
      text,
      html,
    });
    console.log("Acknowledgement email sent to", email);
  } catch (err) {
    // Never fail the submission — it's already safely captured by Netlify Forms.
    console.error("Failed to send acknowledgement email:", err && err.message);
  }

  return { statusCode: 200, body: "Done." };
};

/* ---- build the acknowledgement email (HTML + plain-text) ---- */
function buildAckEmail(data) {
  const firstName = String(data.name || "").trim().split(" ")[0] || "there";
  const appliance = String(data.appliance || "").trim();
  const brand = String(data.brand || "").trim();
  const suburb = String(data.suburb || "").trim();
  const dial = toDial(BUSINESS_PHONE);

  const subject = `We've got your booking request — ${BUSINESS_NAME}`;

  const rows = [
    appliance && ["Appliance", appliance],
    brand && ["Brand", brand],
    suburb && ["Suburb", suburb],
  ].filter(Boolean);

  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;color:#5b6b6a;font-size:14px;">${k}</td>` +
        `<td style="padding:6px 0;font-weight:600;color:#0f2e2b;font-size:14px;text-align:right;">${escapeHtml(v)}</td></tr>`
    )
    .join("");

  const text =
    `Hi ${firstName},\n\n` +
    `Thanks for your booking request with ${BUSINESS_NAME} — we've received it ` +
    `and we'll text you shortly to lock in a time.\n\n` +
    `No payment now, and nothing's locked in until we confirm.\n\n` +
    `Need it sooner? Call us on ${BUSINESS_PHONE}.\n\n` +
    `— ${BUSINESS_NAME}\n` +
    `This is an automated confirmation. Please don't reply to this email.`;

  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f2e2b;">` +
      `<div style="background:#0f3d39;color:#ffffff;padding:22px 24px;border-radius:14px 14px 0 0;">` +
        `<div style="font-size:18px;font-weight:700;">${escapeHtml(BUSINESS_NAME)}</div>` +
        `<div style="font-size:13px;opacity:.8;">Melbourne &middot; Repairs &amp; Service</div>` +
      `</div>` +
      `<div style="border:1px solid #e3e8e7;border-top:0;border-radius:0 0 14px 14px;padding:24px;">` +
        `<h1 style="font-size:20px;margin:0 0 12px;">Request received &mdash; nice one!</h1>` +
        `<p style="margin:0 0 14px;line-height:1.55;">Hi ${escapeHtml(firstName)}, thanks for reaching out. ` +
        `We've got your booking request and <strong>we'll text you shortly to lock in a time.</strong> ` +
        `No payment now, and nothing's locked in until we confirm.</p>` +
        (rowsHtml
          ? `<table style="width:100%;border-collapse:collapse;margin:8px 0 18px;">${rowsHtml}</table>`
          : ``) +
        `<p style="margin:0;line-height:1.55;">Need it sooner? Call us on ` +
        `<a href="tel:${dial}" style="color:#0f7a73;font-weight:600;text-decoration:none;">${escapeHtml(BUSINESS_PHONE)}</a>.</p>` +
      `</div>` +
      `<p style="font-size:12px;color:#9aa7a5;text-align:center;margin:14px 0 0;">` +
        `This is an automated confirmation &mdash; please don't reply to this email.</p>` +
    `</div>`;

  return { subject, html, text };
}

// "0410 137 427" -> "+61410137427"
function toDial(display) {
  const digits = String(display).replace(/[^\d]/g, "");
  return digits.startsWith("0") ? "+61" + digits.slice(1) : "+" + digits;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
