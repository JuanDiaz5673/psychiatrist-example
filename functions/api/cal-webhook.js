// POST /api/cal-webhook
//
// Cal.com sends booking events here. We verify the HMAC signature,
// parse the payload, and send a branded confirmation email via Resend.
//
// Cal config:
//   Settings -> Developer -> Webhooks -> New
//   Subscriber URL: https://<your-pages-domain>/api/cal-webhook
//   Event Triggers: BOOKING_CREATED
//   Secret: a long random string -- set the SAME value as CAL_WEBHOOK_SECRET
//           in Cloudflare Pages env vars.

import { sendBookingEmail } from "./_email.js";
import { json, handler, HttpError } from "./_shared.js";

const RELEVANT_TRIGGERS = new Set(["BOOKING_CREATED"]);

/** Constant-time string comparison */
function constantTimeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Compute HMAC-SHA256 hex digest of bodyText using secret. */
async function hmacSha256Hex(secret, bodyText) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(bodyText));
  const bytes = new Uint8Array(sigBuf);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export const onRequestPost = handler(async ({ env, request }) => {
  // Read the raw body once -- HMAC must be computed on the exact bytes.
  const bodyText = await request.text();

  // ----- 1. Signature verification (optional but recommended) -----
  // Cal sends "X-Cal-Signature-256" header containing the hex digest.
  if (env.CAL_WEBHOOK_SECRET) {
    const sigHeader = request.headers.get("x-cal-signature-256") || "";
    const expected = await hmacSha256Hex(env.CAL_WEBHOOK_SECRET, bodyText);
    if (!constantTimeEq(sigHeader.trim(), expected)) {
      throw new HttpError(401, "invalid signature");
    }
  }

  // ----- 2. Parse the event -----
  let event;
  try { event = JSON.parse(bodyText); }
  catch { throw new HttpError(400, "body must be JSON"); }

  const trigger = event?.triggerEvent;
  if (!RELEVANT_TRIGGERS.has(trigger)) {
    // ack non-relevant events so Cal doesn't keep retrying
    return json({ ok: true, ignored: trigger });
  }

  const p = event.payload || {};
  // attendee can be in payload.attendees[0] OR payload.responses.email/name
  const attendee = (Array.isArray(p.attendees) && p.attendees[0]) || {};
  const attendeeEmail = attendee.email || p?.responses?.email?.value;
  const attendeeName = attendee.name || p?.responses?.name?.value || "there";
  const attendeeTz = attendee.timeZone || p?.organizer?.timeZone || "America/New_York";
  const startISO = p.startTime;
  const endISO = p.endTime;
  const eventTitle = p.type || p.title || "Initial consultation";
  const locationUrl = p.location || (p?.metadata?.videoCallUrl) || "";
  const bookingUid = p.uid || `booking-${Date.now()}`;
  const organizerEmail = p?.organizer?.email || "juandiaz5673@gmail.com";
  const organizerName = p?.organizer?.name || "Saudia J. Rahim";

  if (!attendeeEmail || !startISO) {
    throw new HttpError(400, "missing attendee email or start time in payload");
  }

  // ----- 3. Send the branded email -----
  const result = await sendBookingEmail(env, {
    bookingUid,
    eventTitle: `${eventTitle} — 50 min`,
    startISO,
    endISO,
    locationUrl,
    timeZone: attendeeTz,
    attendeeName,
    attendeeEmail,
    organizerName,
    organizerEmail,
  });

  return json({ ok: true, emailId: result?.id || null, sentTo: attendeeEmail });
});

// Some platforms/health checks GET the URL — respond friendly.
export const onRequestGet = handler(async () => {
  return json({ ok: true, ready: true, note: "POST a Cal.com webhook payload here." });
});
