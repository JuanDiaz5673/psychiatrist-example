// Email module — sends Wisteria-branded booking confirmations via Resend.
//
// Inputs (from the Cal webhook payload):
//   bookingUid, eventTitle, startISO, endISO, locationUrl, timeZone,
//   attendeeName, attendeeEmail
//
// Output: posts to Resend, returns { id } or throws.

const RESEND_BASE = "https://api.resend.com";

// from + reply-to: change for production once a real domain is verified.
const FROM_EMAIL = "Wisteria Counseling <onboarding@resend.dev>";
const REPLY_TO   = "juandiaz5673@gmail.com";   // TODO: swap to Wisteriaconseling@gmail.com for prod

/** Format a Date-ish to a long human-readable string in `timeZone`. */
function fmtLong(iso, timeZone) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
}

function fmtDateOnly(iso, timeZone) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

function fmtTimeOnly(iso, timeZone) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone, hour: "numeric", minute: "2-digit", hour12: true,
  });
}

/** Convert an ISO instant to the iCalendar UTC format YYYYMMDDTHHMMSSZ. */
function toIcsUtc(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Escape text for an .ics field (commas, semicolons, newlines). */
function icsEscape(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Build a complete .ics calendar invite. */
export function buildICS({ uid, summary, description, startISO, endISO, locationUrl, organizerName, organizerEmail, attendeeName, attendeeEmail }) {
  const dtstamp = toIcsUtc(new Date().toISOString());
  const dtstart = toIcsUtc(startISO);
  const dtend = toIcsUtc(endISO);
  // 75-char-line fold per RFC 5545 isn't strictly required for short fields; we'll skip it for readability.
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Wisteria Counseling//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${icsEscape(uid)}@wisteriacounseling.com`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(description || "")}`,
    `LOCATION:${icsEscape(locationUrl || "Telehealth — link to follow")}`,
    `ORGANIZER;CN=${icsEscape(organizerName)}:MAILTO:${organizerEmail}`,
    `ATTENDEE;CN=${icsEscape(attendeeName)};RSVP=TRUE:MAILTO:${attendeeEmail}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/** Base64-encode a UTF-8 string for the Resend attachment field. */
function base64Utf8(str) {
  // Workers + browsers support btoa on bytes; for UTF-8 we encode first.
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  // eslint-disable-next-line no-undef
  return btoa(bin);
}

/**
 * Build the HTML body. Designed for email clients (inline styles, table-based
 * layout for older clients, max-width 600, no external CSS).
 */
function buildHtml({ firstName, dateLong, timeLong, eventTitle, locationLine, bookingUid, replyEmail }) {
  // Centralized colors so any tweak is one place
  const c = {
    teal: "#7B5FA1",
    tealD: "#5A3F80",
    tealL: "#EDE5F4",
    leaf: "#7C9E6C",
    bg: "#FBFAFD",
    card: "#FFFFFF",
    text: "#1F1429",
    text2: "#54485F",
    text3: "#847A8F",
    border: "#E6DFEB",
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>Your appointment with Wisteria Counseling</title>
</head>
<body style="margin:0;padding:0;background:${c.bg};font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${c.text};">

  <!-- preview text shown in inbox list -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${c.bg};opacity:0;">
    You're booked for ${dateLong} at ${timeLong}. Saudia will see you then.
  </div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${c.bg};">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;">

          <!-- brand -->
          <tr>
            <td style="padding-bottom:28px;text-align:center;">
              <div style="font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:22px;letter-spacing:-.01em;color:${c.text};">
                Wisteria Counseling
              </div>
              <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${c.text3};margin-top:4px;">
                Saudia J. Rahim &middot; MHC
              </div>
            </td>
          </tr>

          <!-- card -->
          <tr>
            <td style="background:${c.card};border:1px solid ${c.border};border-radius:14px;padding:0;overflow:hidden;">

              <!-- gradient ribbon -->
              <div style="height:3px;background:linear-gradient(90deg,${c.teal} 0%,${c.tealD} 50%,${c.leaf} 100%);line-height:3px;font-size:1px;">&nbsp;</div>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="padding:36px 36px 28px;">

                    <!-- kicker -->
                    <div style="text-align:center;font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:${c.tealD};margin-bottom:14px;">
                      Appointment confirmed
                    </div>

                    <!-- headline -->
                    <h1 style="margin:0 0 16px;text-align:center;font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:28px;line-height:1.2;letter-spacing:-.015em;color:${c.text};">
                      Hi ${firstName}, you're booked.
                    </h1>

                    <!-- personal note from Saudia -->
                    <p style="margin:0 0 24px;text-align:center;font-size:15px;line-height:1.6;color:${c.text2};">
                      Thanks for reaching out. I'm glad you took the step to schedule, and I'm looking forward to meeting you. The first session is mostly about getting a sense of what brings you in and whether we're a good fit &mdash; no pressure to share more than you're ready to.
                    </p>

                    <!-- when card -->
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${c.tealL};border-radius:10px;margin-bottom:24px;">
                      <tr>
                        <td style="padding:18px 22px;">
                          <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:${c.tealD};margin-bottom:6px;">When</div>
                          <div style="font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:18px;color:${c.text};">${dateLong}</div>
                          <div style="font-size:14px;color:${c.text2};margin-top:2px;">${timeLong}</div>
                          <div style="border-top:1px dashed rgba(123,95,161,.25);margin:14px 0;line-height:1px;">&nbsp;</div>
                          <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:${c.tealD};margin-bottom:6px;">What</div>
                          <div style="font-size:14px;color:${c.text};">${eventTitle}</div>
                          <div style="border-top:1px dashed rgba(123,95,161,.25);margin:14px 0;line-height:1px;">&nbsp;</div>
                          <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:${c.tealD};margin-bottom:6px;">Where</div>
                          <div style="font-size:14px;color:${c.text};">${locationLine}</div>
                        </td>
                      </tr>
                    </table>

                    <!-- what to expect -->
                    <div style="margin-top:8px;">
                      <div style="text-align:center;font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:${c.tealD};margin-bottom:14px;">
                        &mdash; What happens next &mdash;
                      </div>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="padding:10px 0;border-bottom:1px solid ${c.border};">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                              <tr>
                                <td width="36" valign="top" style="font-family:'Fraunces',serif;font-size:14px;font-weight:600;color:${c.tealD};">01</td>
                                <td valign="top">
                                  <div style="font-weight:600;font-size:14px;color:${c.text};margin-bottom:2px;">Secure intake form</div>
                                  <div style="font-size:13px;color:${c.text2};line-height:1.5;">A short, secure intake will follow by separate email &mdash; that's where insurance and what's bringing you in is collected.</div>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:10px 0;border-bottom:1px solid ${c.border};">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                              <tr>
                                <td width="36" valign="top" style="font-family:'Fraunces',serif;font-size:14px;font-weight:600;color:${c.tealD};">02</td>
                                <td valign="top">
                                  <div style="font-weight:600;font-size:14px;color:${c.text};margin-bottom:2px;">Add to your calendar</div>
                                  <div style="font-size:13px;color:${c.text2};line-height:1.5;">The .ics file attached to this email will add the appointment to whatever calendar you use.</div>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:10px 0;">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                              <tr>
                                <td width="36" valign="top" style="font-family:'Fraunces',serif;font-size:14px;font-weight:600;color:${c.tealD};">03</td>
                                <td valign="top">
                                  <div style="font-weight:600;font-size:14px;color:${c.text};margin-bottom:2px;">Your first session</div>
                                  <div style="font-size:13px;color:${c.text2};line-height:1.5;">A relaxed conversation. Bring whatever feels useful &mdash; or nothing at all. We'll figure out the rest together.</div>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </div>

                    <!-- saudia signature -->
                    <div style="margin-top:28px;padding-top:24px;border-top:1px solid ${c.border};text-align:center;">
                      <div style="font-family:'Fraunces',serif;font-style:italic;font-size:15px;color:${c.text};margin-bottom:4px;">&mdash; Saudia</div>
                      <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${c.text3};">Saudia J. Rahim, MHC</div>
                    </div>

                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- footer -->
          <tr>
            <td style="padding:24px 12px 0;text-align:center;font-size:12px;color:${c.text3};line-height:1.6;">
              Questions? Just reply to this email &mdash; it reaches us directly.<br>
              Not for emergencies. In crisis, call <strong>988</strong> or go to your nearest emergency department.
            </td>
          </tr>

          <tr>
            <td style="padding:18px 12px;text-align:center;font-size:11px;color:${c.text3};">
              Reference: <span style="font-family:'Consolas','Courier New',monospace;">${bookingUid}</span>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Plain-text fallback for the few clients that ignore HTML. */
function buildText({ firstName, dateLong, timeLong, eventTitle, locationLine, bookingUid }) {
  return [
    `Hi ${firstName},`,
    ``,
    `You're booked.`,
    ``,
    `When:  ${dateLong} at ${timeLong}`,
    `What:  ${eventTitle}`,
    `Where: ${locationLine}`,
    ``,
    `Thanks for reaching out. I'm glad you took the step to schedule, and I'm looking forward to meeting you. The first session is mostly about getting a sense of what brings you in and whether we're a good fit — no pressure to share more than you're ready to.`,
    ``,
    `What happens next:`,
    `  1. A short secure intake form will follow by separate email.`,
    `  2. Add the appointment to your calendar with the attached .ics file.`,
    `  3. We meet at the scheduled time — relaxed conversation, no prep needed.`,
    ``,
    `— Saudia`,
    `Saudia J. Rahim, MHC`,
    ``,
    `Questions? Just reply to this email.`,
    `Not for emergencies. In crisis, call 988.`,
    ``,
    `Reference: ${bookingUid}`,
  ].join("\n");
}

/**
 * Send the booking confirmation email through Resend.
 * Throws on failure (caller decides how to surface).
 */
export async function sendBookingEmail(env, params) {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY not configured");
  }

  const { bookingUid, eventTitle, startISO, endISO, locationUrl, timeZone, attendeeName, attendeeEmail, organizerName, organizerEmail } = params;
  const firstName = (attendeeName || "there").split(/\s+/)[0];
  const dateLong = fmtDateOnly(startISO, timeZone);
  const timeLong = fmtTimeOnly(startISO, timeZone) + " (" +
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(new Date(startISO))
      .find((p) => p.type === "timeZoneName")?.value + ")";
  const locationLine = locationUrl && locationUrl.startsWith("http")
    ? "Telehealth — video link in calendar invite"
    : (locationUrl || "Telehealth — link to follow");

  const html = buildHtml({ firstName, dateLong, timeLong, eventTitle, locationLine, bookingUid, replyEmail: REPLY_TO });
  const text = buildText({ firstName, dateLong, timeLong, eventTitle, locationLine, bookingUid });
  const ics = buildICS({
    uid: bookingUid,
    summary: eventTitle,
    description: "Your appointment with Saudia at Wisteria Counseling. A separate secure intake will follow by email.",
    startISO, endISO,
    locationUrl: locationLine,
    organizerName, organizerEmail,
    attendeeName, attendeeEmail,
  });

  const body = {
    from: FROM_EMAIL,
    to: [attendeeEmail],
    reply_to: REPLY_TO,
    subject: `Your appointment with Wisteria Counseling — ${dateLong}`,
    html,
    text,
    attachments: [
      {
        filename: "wisteria-appointment.ics",
        content: base64Utf8(ics),
      },
    ],
  };

  const res = await fetch(`${RESEND_BASE}/emails`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      // Cloudflare edge sometimes 403s requests without an explicit UA
      "User-Agent": "wisteria-counseling/1.0",
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }

  if (!res.ok) {
    const msg = parsed?.message || parsed?.error || raw;
    throw new Error(`Resend ${res.status}: ${msg}`);
  }
  return parsed;
}
