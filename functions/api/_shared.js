// Shared helpers for Cal.com proxy functions.
// Pages Functions runtime: standard Web Fetch API (Workers runtime).

export const EVENT_TYPE_ID = 5752260;          // "Initial consultation" (50 min)
export const EVENT_TYPE_SLUG = "consultation";
export const USERNAME = "juan-diaz-d8yrgf";
export const DEFAULT_TIMEZONE = "America/New_York";

const CAL_BASE = "https://api.cal.com/v2";

/** Build headers for a Cal API call. apiKey from Pages env vars only. */
function calHeaders(apiKey, version) {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "cal-api-version": version,
    "Content-Type": "application/json",
    // Cloudflare's edge sometimes 403s requests without a UA — be polite.
    "User-Agent": "wisteria-counseling/1.0",
  };
}

/** GET a Cal API path with the given api-version. Returns parsed JSON or throws. */
export async function calGet(env, path, version) {
  if (!env.CAL_API_KEY) {
    throw new HttpError(500, "CAL_API_KEY not configured on this environment");
  }
  const res = await fetch(`${CAL_BASE}${path}`, {
    method: "GET",
    headers: calHeaders(env.CAL_API_KEY, version),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new HttpError(res.status, `cal upstream ${res.status}: ${body.slice(0, 400)}`);
  }
  return JSON.parse(body);
}

/** POST a Cal API path with the given api-version. */
export async function calPost(env, path, version, body) {
  if (!env.CAL_API_KEY) {
    throw new HttpError(500, "CAL_API_KEY not configured on this environment");
  }
  const res = await fetch(`${CAL_BASE}${path}`, {
    method: "POST",
    headers: calHeaders(env.CAL_API_KEY, version),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* leave as text */ }
  if (!res.ok) {
    const msg = parsed?.error?.message || parsed?.message || text.slice(0, 400);
    throw new HttpError(res.status, msg);
  }
  return parsed;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Standard JSON response with CORS-permissive headers (single-domain so this is just for dev). */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** Wrap a handler so unhandled errors return a structured JSON error. */
export function handler(fn) {
  return async (ctx) => {
    try {
      return await fn(ctx);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const message = e?.message || "unknown error";
      // Map upstream 4xx to client-friendly 4xx, keep 5xx as server errors.
      return json({ ok: false, error: { status, message } }, status >= 400 && status < 600 ? status : 500);
    }
  };
}
