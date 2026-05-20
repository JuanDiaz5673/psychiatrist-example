// GET /api/event-type
// Returns the basic event-type info the frontend needs to render
// (title, length, description, custom intake questions).

import { calGet, EVENT_TYPE_ID, EVENT_TYPE_SLUG, USERNAME, DEFAULT_TIMEZONE, json, handler } from "./_shared.js";

export const onRequestGet = handler(async ({ env }) => {
  const result = await calGet(env, `/event-types/${EVENT_TYPE_ID}`, "2024-06-14");
  const et = result.data;

  const customFields = (et.bookingFields || [])
    .filter((f) => !f.isDefault)
    .map((f) => ({
      slug: f.slug,
      type: f.type,           // "radio" | "text" | etc.
      label: f.label,
      required: !!f.required,
      placeholder: f.placeholder || "",
      options: f.options || null,
    }));

  return json({
    ok: true,
    eventType: {
      id: et.id,
      slug: EVENT_TYPE_SLUG,
      username: USERNAME,
      title: et.title,
      description: et.description || "",
      lengthInMinutes: et.lengthInMinutes,
      defaultTimezone: DEFAULT_TIMEZONE,
      customFields,
    },
  });
});
