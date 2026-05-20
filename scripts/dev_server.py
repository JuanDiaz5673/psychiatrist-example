"""Local dev server that mimics the Cloudflare Pages Functions setup.

Serves static files from project root, and proxies /api/event-type,
/api/slots, /api/book to Cal.com using CAL_API_KEY from .env / .dev.vars.

Production uses the Pages Functions in /functions/api/*.js — this is dev only.

Run with:  python scripts/dev_server.py
"""
import http.server
import json
import os
import socketserver
import sys
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = int(os.environ.get("DEV_PORT", "5174"))

# Mirror the constants in functions/api/_shared.js so dev and prod match.
EVENT_TYPE_ID = 5752260
EVENT_TYPE_SLUG = "consultation"
USERNAME = "juan-diaz-d8yrgf"
DEFAULT_TZ = "America/New_York"
CAL_BASE = "https://api.cal.com/v2"

# Load API key from .dev.vars (preferred) or .env.
for fname in (".dev.vars", ".env"):
    p = ROOT / fname
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

API_KEY = os.environ.get("CAL_API_KEY")
if not API_KEY:
    print("WARN: CAL_API_KEY not set — API routes will return 500")


def cal_request(method, path, body=None, api_version="2024-06-14"):
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "cal-api-version": api_version,
        "Content-Type": "application/json",
        "User-Agent": "wisteria-dev/1.0",
    }
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{CAL_BASE}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        try:
            return e.code, json.loads(text)
        except Exception:
            return e.code, {"error": {"message": text[:400]}}


def _send_via_resend(*, api_key, booking_uid, event_title, start_iso, end_iso,
                     location_url, time_zone, attendee_name, attendee_email,
                     organizer_name, organizer_email):
    """Local-dev mirror of functions/api/_email.js sendBookingEmail.

    Builds the HTML email and ICS attachment, POSTs to Resend. Returns email id.
    """
    import base64
    from datetime import datetime
    from zoneinfo import ZoneInfo

    tz = ZoneInfo(time_zone) if time_zone else ZoneInfo("America/New_York")
    start_dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00")).astimezone(tz)
    end_dt = datetime.fromisoformat(end_iso.replace("Z", "+00:00")).astimezone(tz)

    # cross-platform formatting (no %-I on Windows)
    weekday = start_dt.strftime("%A")
    month = start_dt.strftime("%B")
    date_long = f"{weekday}, {month} {start_dt.day}, {start_dt.year}"
    hr_12 = ((start_dt.hour - 1) % 12) + 1
    ampm = "PM" if start_dt.hour >= 12 else "AM"
    tz_short = start_dt.tzname() or time_zone
    time_long = f"{hr_12}:{start_dt.minute:02d} {ampm} ({tz_short})"

    first_name = (attendee_name or "there").split()[0]

    location_line = (
        "Telehealth — video link in calendar invite"
        if location_url and location_url.startswith("http")
        else (location_url or "Telehealth — link to follow")
    )

    # color tokens (kept in sync with _email.js)
    c = dict(teal="#7B5FA1", tealD="#5A3F80", tealL="#EDE5F4", leaf="#7C9E6C",
             bg="#FBFAFD", card="#FFFFFF", text="#1F1429", text2="#54485F",
             text3="#847A8F", border="#E6DFEB")

    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting"><title>Your appointment with Wisteria Counseling</title></head>
<body style="margin:0;padding:0;background:{c['bg']};font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:{c['text']};">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:{c['bg']};opacity:0;">You're booked for {date_long} at {time_long}.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:{c['bg']};">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;">
<tr><td style="padding-bottom:28px;text-align:center;">
<div style="font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:22px;letter-spacing:-.01em;color:{c['text']};">Wisteria Counseling</div>
<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:{c['text3']};margin-top:4px;">Saudia J. Rahim &middot; MHC</div>
</td></tr>
<tr><td style="background:{c['card']};border:1px solid {c['border']};border-radius:14px;padding:0;overflow:hidden;">
<div style="height:3px;background:linear-gradient(90deg,{c['teal']} 0%,{c['tealD']} 50%,{c['leaf']} 100%);line-height:3px;font-size:1px;">&nbsp;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:36px 36px 28px;">
<div style="text-align:center;font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:{c['tealD']};margin-bottom:14px;">Appointment confirmed</div>
<h1 style="margin:0 0 16px;text-align:center;font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:28px;line-height:1.2;letter-spacing:-.015em;color:{c['text']};">Hi {first_name}, you're booked.</h1>
<p style="margin:0 0 24px;text-align:center;font-size:15px;line-height:1.6;color:{c['text2']};">Thanks for reaching out. I'm glad you took the step to schedule, and I'm looking forward to meeting you. The first session is mostly about getting a sense of what brings you in and whether we're a good fit &mdash; no pressure to share more than you're ready to.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:{c['tealL']};border-radius:10px;margin-bottom:24px;"><tr><td style="padding:18px 22px;">
<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:{c['tealD']};margin-bottom:6px;">When</div>
<div style="font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:18px;color:{c['text']};">{date_long}</div>
<div style="font-size:14px;color:{c['text2']};margin-top:2px;">{time_long}</div>
<div style="border-top:1px dashed rgba(123,95,161,.25);margin:14px 0;line-height:1px;">&nbsp;</div>
<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:{c['tealD']};margin-bottom:6px;">What</div>
<div style="font-size:14px;color:{c['text']};">{event_title}</div>
<div style="border-top:1px dashed rgba(123,95,161,.25);margin:14px 0;line-height:1px;">&nbsp;</div>
<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:{c['tealD']};margin-bottom:6px;">Where</div>
<div style="font-size:14px;color:{c['text']};">{location_line}</div>
</td></tr></table>
<div style="margin-top:8px;"><div style="text-align:center;font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:{c['tealD']};margin-bottom:14px;">&mdash; What happens next &mdash;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr><td style="padding:10px 0;border-bottom:1px solid {c['border']};"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="36" valign="top" style="font-family:'Fraunces',serif;font-size:14px;font-weight:600;color:{c['tealD']};">01</td><td valign="top"><div style="font-weight:600;font-size:14px;color:{c['text']};margin-bottom:2px;">Secure intake form</div><div style="font-size:13px;color:{c['text2']};line-height:1.5;">A short, secure intake will follow by separate email &mdash; that's where insurance and what's bringing you in is collected.</div></td></tr></table></td></tr>
<tr><td style="padding:10px 0;border-bottom:1px solid {c['border']};"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="36" valign="top" style="font-family:'Fraunces',serif;font-size:14px;font-weight:600;color:{c['tealD']};">02</td><td valign="top"><div style="font-weight:600;font-size:14px;color:{c['text']};margin-bottom:2px;">Add to your calendar</div><div style="font-size:13px;color:{c['text2']};line-height:1.5;">The .ics file attached to this email will add the appointment to whatever calendar you use.</div></td></tr></table></td></tr>
<tr><td style="padding:10px 0;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="36" valign="top" style="font-family:'Fraunces',serif;font-size:14px;font-weight:600;color:{c['tealD']};">03</td><td valign="top"><div style="font-weight:600;font-size:14px;color:{c['text']};margin-bottom:2px;">Your first session</div><div style="font-size:13px;color:{c['text2']};line-height:1.5;">A relaxed conversation. Bring whatever feels useful &mdash; or nothing at all. We'll figure out the rest together.</div></td></tr></table></td></tr>
</table></div>
<div style="margin-top:28px;padding-top:24px;border-top:1px solid {c['border']};text-align:center;">
<div style="font-family:'Fraunces',serif;font-style:italic;font-size:15px;color:{c['text']};margin-bottom:4px;">&mdash; Saudia</div>
<div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:{c['text3']};">Saudia J. Rahim, MHC</div>
</div></td></tr></table></td></tr>
<tr><td style="padding:24px 12px 0;text-align:center;font-size:12px;color:{c['text3']};line-height:1.6;">Questions? Just reply to this email &mdash; it reaches us directly.<br>Not for emergencies. In crisis, call <strong>988</strong> or go to your nearest emergency department.</td></tr>
<tr><td style="padding:18px 12px;text-align:center;font-size:11px;color:{c['text3']};">Reference: <span style="font-family:'Consolas','Courier New',monospace;">{booking_uid}</span></td></tr>
</table></td></tr></table></body></html>"""

    text_body = (
        f"Hi {first_name},\n\n"
        f"You're booked.\n\n"
        f"When:  {date_long} at {time_long}\n"
        f"What:  {event_title}\n"
        f"Where: {location_line}\n\n"
        f"Thanks for reaching out. I'm glad you took the step to schedule, and I'm "
        f"looking forward to meeting you. The first session is mostly about getting "
        f"a sense of what brings you in and whether we're a good fit — no pressure "
        f"to share more than you're ready to.\n\n"
        f"What happens next:\n"
        f"  1. A short secure intake form will follow by separate email.\n"
        f"  2. Add the appointment to your calendar with the attached .ics file.\n"
        f"  3. We meet at the scheduled time.\n\n"
        f"— Saudia\nSaudia J. Rahim, MHC\n\n"
        f"Questions? Just reply to this email.\n"
        f"Not for emergencies. In crisis, call 988.\n\n"
        f"Reference: {booking_uid}\n"
    )

    # Build .ics
    def ics_dt(iso):
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%Y%m%dT%H%M%SZ")

    def ics_esc(s):
        return (str(s).replace("\\", "\\\\").replace("\n", "\\n")
                       .replace(",", "\\,").replace(";", "\\;"))

    ics = "\r\n".join([
        "BEGIN:VCALENDAR", "VERSION:2.0",
        "PRODID:-//Wisteria Counseling//Booking//EN",
        "CALSCALE:GREGORIAN", "METHOD:REQUEST",
        "BEGIN:VEVENT",
        f"UID:{ics_esc(booking_uid)}@wisteriacounseling.com",
        f"DTSTAMP:{datetime.now(ZoneInfo('UTC')).strftime('%Y%m%dT%H%M%SZ')}",
        f"DTSTART:{ics_dt(start_iso)}",
        f"DTEND:{ics_dt(end_iso)}",
        f"SUMMARY:{ics_esc(event_title)}",
        f"DESCRIPTION:{ics_esc('Your appointment with Saudia at Wisteria Counseling.')}",
        f"LOCATION:{ics_esc(location_line)}",
        f"ORGANIZER;CN={ics_esc(organizer_name)}:MAILTO:{organizer_email}",
        f"ATTENDEE;CN={ics_esc(attendee_name)};RSVP=TRUE:MAILTO:{attendee_email}",
        "STATUS:CONFIRMED", "SEQUENCE:0",
        "END:VEVENT", "END:VCALENDAR",
    ])

    body = {
        "from": "Wisteria Counseling <onboarding@resend.dev>",
        "to": [attendee_email],
        "reply_to": "juandiaz5673@gmail.com",
        "subject": f"Your appointment with Wisteria Counseling — {date_long}",
        "html": html,
        "text": text_body,
        "attachments": [{
            "filename": "wisteria-appointment.ics",
            "content": base64.b64encode(ics.encode()).decode(),
        }],
    }

    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "wisteria-dev/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode())
            return result.get("id")
    except urllib.error.HTTPError as e:
        msg = e.read().decode()
        raise Exception(f"{e.code} {msg[:300]}")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # ----- shared JSON helpers -----
    def _send_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _bad_request(self, msg):
        self._send_json(400, {"ok": False, "error": {"status": 400, "message": msg}})

    # ----- routing -----
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/event-type":
            return self._handle_event_type()
        if parsed.path == "/api/slots":
            return self._handle_slots(parsed)
        # static fallback
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/book":
            return self._handle_book()
        if parsed.path == "/api/cal-webhook":
            return self._handle_webhook()
        self.send_error(404)

    # ----- handlers -----
    def _handle_event_type(self):
        status, data = cal_request("GET", f"/event-types/{EVENT_TYPE_ID}", api_version="2024-06-14")
        if status >= 400:
            return self._send_json(status, {"ok": False, "error": data.get("error", {})})
        et = data.get("data", {})
        custom = []
        for f in et.get("bookingFields", []) or []:
            if f.get("isDefault"):
                continue
            custom.append({
                "slug": f.get("slug"),
                "type": f.get("type"),
                "label": f.get("label"),
                "required": bool(f.get("required")),
                "placeholder": f.get("placeholder", ""),
                "options": f.get("options"),
            })
        self._send_json(200, {
            "ok": True,
            "eventType": {
                "id": et.get("id"),
                "slug": EVENT_TYPE_SLUG,
                "username": USERNAME,
                "title": et.get("title"),
                "description": et.get("description", ""),
                "lengthInMinutes": et.get("lengthInMinutes"),
                "defaultTimezone": DEFAULT_TZ,
                "customFields": custom,
            },
        })

    def _handle_slots(self, parsed):
        q = urllib.parse.parse_qs(parsed.query)
        start = (q.get("start") or [""])[0]
        end = (q.get("end") or [""])[0]
        tz = (q.get("timeZone") or [DEFAULT_TZ])[0]
        if not start or not end:
            return self._bad_request("start and end (YYYY-MM-DD) required")
        params = urllib.parse.urlencode({
            "eventTypeId": EVENT_TYPE_ID,
            "start": f"{start}T00:00:00.000Z",
            "end": f"{end}T23:59:59.999Z",
            "timeZone": tz,
        })
        status, data = cal_request("GET", f"/slots?{params}", api_version="2024-09-04")
        if status >= 400:
            return self._send_json(status, {"ok": False, "error": data.get("error", {})})
        self._send_json(200, {"ok": True, "timeZone": tz, "slots": data.get("data", {})})

    def _handle_book(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length).decode()) if length else {}
        except Exception:
            return self._bad_request("request body must be JSON")

        start = body.get("start", "")
        name = (body.get("name") or "").strip()
        email = (body.get("email") or "").strip().lower()
        phone = (body.get("phone") or "").strip()
        tz = (body.get("timeZone") or DEFAULT_TZ).strip()
        responses = body.get("responses") or {}
        if not isinstance(responses, dict):
            responses = {}

        if not start:
            return self._bad_request("start required")
        if not name:
            return self._bad_request("name required")
        if "@" not in email:
            return self._bad_request("valid email required")

        # honeypot
        if responses.get("website"):
            return self._send_json(200, {"ok": True, "booking": {"id": "honeypot", "start": start}})

        attendee = {"name": name, "email": email, "timeZone": tz, "language": "en"}
        if phone:
            attendee["phoneNumber"] = phone

        clean_responses = {k: v for k, v in responses.items() if k != "website" and v not in (None, "")}

        cal_body = {
            "start": start,
            "eventTypeId": EVENT_TYPE_ID,
            "attendee": attendee,
            "bookingFieldsResponses": clean_responses,
            "metadata": {},
        }

        status, data = cal_request("POST", "/bookings", body=cal_body, api_version="2024-08-13")
        if status >= 400:
            err = data.get("error", {}) if isinstance(data, dict) else {}
            return self._send_json(status, {"ok": False, "error": {"status": status, "message": err.get("message") or "booking failed"}})

        booking = data.get("data", {}) if isinstance(data, dict) else {}
        self._send_json(200, {
            "ok": True,
            "booking": {
                "id": booking.get("id"),
                "uid": booking.get("uid"),
                "start": booking.get("start") or start,
                "end": booking.get("end"),
                "meetingUrl": booking.get("meetingUrl") or booking.get("location"),
            },
        })

    def _handle_webhook(self):
        """Receive a Cal-shaped payload and send the branded email via Resend.

        Mirrors functions/api/cal-webhook.js so local dev exercises the same flow.
        """
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode() if length else ""
        try:
            event = json.loads(raw) if raw else {}
        except Exception:
            return self._bad_request("body must be JSON")

        # signature verification — mirrors prod
        secret = os.environ.get("CAL_WEBHOOK_SECRET")
        if secret:
            import hmac, hashlib
            sig = self.headers.get("X-Cal-Signature-256", "").strip()
            expected = hmac.new(secret.encode(), raw.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(sig, expected):
                return self._send_json(401, {"ok": False, "error": "invalid signature"})

        trigger = event.get("triggerEvent")
        if trigger != "BOOKING_CREATED":
            return self._send_json(200, {"ok": True, "ignored": trigger})

        p = event.get("payload", {}) or {}
        attendees = p.get("attendees") or []
        a = attendees[0] if attendees else {}
        resp = p.get("responses") or {}
        attendee_email = a.get("email") or (resp.get("email") or {}).get("value")
        attendee_name = a.get("name") or (resp.get("name") or {}).get("value") or "there"
        attendee_tz = a.get("timeZone") or (p.get("organizer") or {}).get("timeZone") or DEFAULT_TZ
        start_iso = p.get("startTime")
        end_iso = p.get("endTime")
        event_title = p.get("type") or p.get("title") or "Initial consultation"
        location_url = p.get("location") or ""
        booking_uid = p.get("uid") or f"booking-{int(__import__('time').time())}"
        organizer = p.get("organizer") or {}

        if not attendee_email or not start_iso:
            return self._bad_request("missing attendee email or start time")

        api_key = os.environ.get("RESEND_API_KEY")
        if not api_key:
            return self._send_json(500, {"ok": False, "error": "RESEND_API_KEY not configured"})

        try:
            email_id = _send_via_resend(
                api_key=api_key,
                booking_uid=booking_uid,
                event_title=f"{event_title} — 50 min",
                start_iso=start_iso,
                end_iso=end_iso,
                location_url=location_url,
                time_zone=attendee_tz,
                attendee_name=attendee_name,
                attendee_email=attendee_email,
                organizer_name=organizer.get("name") or "Saudia J. Rahim",
                organizer_email=organizer.get("email") or "juandiaz5673@gmail.com",
            )
        except Exception as e:
            return self._send_json(502, {"ok": False, "error": f"resend failed: {e}"})

        self._send_json(200, {"ok": True, "emailId": email_id, "sentTo": attendee_email})

    # quieter logs
    def log_message(self, fmt, *args):
        sys.stderr.write(f"[dev] {self.address_string()} - {fmt % args}\n")


class ReusableTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    print(f"Wisteria dev server -> http://localhost:{PORT}")
    print(f"API: /api/event-type  /api/slots  /api/book")
    print(f"key loaded: {bool(API_KEY)}")
    with ReusableTCPServer(("127.0.0.1", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nshutting down")
