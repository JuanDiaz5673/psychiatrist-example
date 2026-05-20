// GET /api/slots?start=YYYY-MM-DD&end=YYYY-MM-DD&timeZone=America/New_York
//
// Returns available time slots for the consultation event type within the
// given range, grouped by local date in the client's timezone.

import { calGet, EVENT_TYPE_ID, DEFAULT_TIMEZONE, json, handler, HttpError } from "./_shared.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const onRequestGet = handler(async ({ env, request }) => {
  const url = new URL(request.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const timeZone = url.searchParams.get("timeZone") || DEFAULT_TIMEZONE;

  if (!start || !ISO_DATE.test(start)) throw new HttpError(400, "start (YYYY-MM-DD) required");
  if (!end || !ISO_DATE.test(end)) throw new HttpError(400, "end (YYYY-MM-DD) required");

  // Cal accepts ISO 8601 with timezone-aware boundaries.
  const startIso = `${start}T00:00:00.000Z`;
  const endIso = `${end}T23:59:59.999Z`;

  const params = new URLSearchParams({
    eventTypeId: String(EVENT_TYPE_ID),
    start: startIso,
    end: endIso,
    timeZone,
  });

  const result = await calGet(env, `/slots?${params.toString()}`, "2024-09-04");
  // result.data is { "YYYY-MM-DD": [{ start: "ISO" }, ...] } already grouped by local date.

  return json({ ok: true, timeZone, slots: result.data || {} });
});
