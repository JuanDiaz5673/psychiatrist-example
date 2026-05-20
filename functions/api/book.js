// POST /api/book
//
// Body shape:
//   {
//     start: "2026-05-25T14:00:00.000Z",
//     name: string,
//     email: string,
//     phone?: string,                 // optional, used as attendee phoneNumber
//     timeZone?: string,              // defaults to America/New_York
//     responses?: { slug: value, ... } // answers to custom booking fields
//   }

import { calPost, EVENT_TYPE_ID, DEFAULT_TIMEZONE, json, handler, HttpError } from "./_shared.js";

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const onRequestPost = handler(async ({ env, request }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "request body must be JSON");
  }

  const start = body?.start;
  const name = (body?.name || "").toString().trim();
  const email = (body?.email || "").toString().trim().toLowerCase();
  const phone = (body?.phone || "").toString().trim();
  const timeZone = (body?.timeZone || DEFAULT_TIMEZONE).toString();
  const responses = body?.responses && typeof body.responses === "object" ? body.responses : {};

  if (!start || !ISO_INSTANT.test(start)) {
    throw new HttpError(400, "start must be an ISO 8601 UTC instant (e.g. 2026-05-25T14:00:00.000Z)");
  }
  if (!name) throw new HttpError(400, "name is required");
  if (!email || !EMAIL_RE.test(email)) throw new HttpError(400, "valid email required");

  // Honeypot check — clients should leave bookingFieldsResponses.website empty.
  if (responses.website) {
    // Pretend success so bots don't probe.
    return json({ ok: true, booking: { id: "honeypot", start } });
  }

  const attendee = {
    name,
    email,
    timeZone,
    language: "en",
  };
  if (phone) attendee.phoneNumber = phone;

  // Cal v2 accepts custom field answers under bookingFieldsResponses, keyed by slug.
  const bookingFieldsResponses = {};
  for (const [slug, value] of Object.entries(responses)) {
    if (slug === "website") continue;          // honeypot, never forward
    if (value === undefined || value === null || value === "") continue;
    bookingFieldsResponses[slug] = value;
  }

  const calBody = {
    start,
    eventTypeId: EVENT_TYPE_ID,
    attendee,
    bookingFieldsResponses,
    metadata: {},
  };

  const result = await calPost(env, "/bookings", "2024-08-13", calBody);
  const booking = result?.data || {};

  return json({
    ok: true,
    booking: {
      id: booking.id || null,
      uid: booking.uid || null,
      start: booking.start || start,
      end: booking.end || null,
      meetingUrl: booking.meetingUrl || booking.location || null,
      icsUrl: booking.icsUid ? `https://cal.com/booking/${booking.uid}` : null,
    },
  });
});
