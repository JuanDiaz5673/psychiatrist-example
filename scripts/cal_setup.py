"""Cal.com setup script for Wisteria Counseling.

Reads CAL_API_KEY from .env, then:
  1. Renames "30 min meeting" -> "Initial consultation", slug /consultation, 50min
  2. Adds non-PHI intake questions (NY residency, format pref, referral source)
  3. Hides the unused 15min and Secret event types
  4. Prints the new public booking URL

Run with:  python scripts/cal_setup.py
"""
import json
import os
import sys
import urllib.request

# Load .env
env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
with open(env_path) as f:
    for line in f:
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.strip().split("=", 1)
            os.environ[k] = v

API_KEY = os.environ["CAL_API_KEY"]
BASE = "https://api.cal.com/v2"
HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "cal-api-version": "2024-06-14",
    "Content-Type": "application/json",
    "User-Agent": "wisteria-setup/1.0",
}


def request(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{BASE}{path}", data=data, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        print(f"  ! HTTP {e.code} on {method} {path}")
        print(f"    {body_text[:600]}")
        sys.exit(1)


# 1. Rename the 30min event type -> Initial consultation (50 min)
print("\n[1/3] Renaming event 5752260 -> 'Initial consultation' (50 min)...")
patch_body = {
    "title": "Initial consultation",
    "slug": "consultation",
    "lengthInMinutes": 50,
    "description": (
        "A 50-minute first session with Saudia to talk about what kind of support "
        "you're looking for and whether we're a good fit. No pressure to share more "
        "than you're ready to."
    ),
    "bookingFields": [
        {
            "type": "phone",
            "slug": "attendeePhoneNumber",
            "label": "Phone",
            "required": False,
            "hidden": False,
        },
        {
            "type": "radio",
            "slug": "ny-resident",
            "label": "Are you a current New York resident?",
            "required": True,
            "options": ["Yes", "No"],
        },
        {
            "type": "radio",
            "slug": "session-format",
            "label": "Session format preference",
            "required": False,
            "options": ["Telehealth", "In-person", "No preference"],
        },
        {
            "type": "text",
            "slug": "referral-source",
            "label": "How did you hear about Wisteria Counseling?",
            "required": False,
            "placeholder": "Psychology Today, a friend, search, etc.",
        },
    ],
}
result = request("PATCH", "/event-types/5752260", patch_body)
et = result["data"]
print(f"  ok: {et['title']} ({et['lengthInMinutes']} min) -> /{et['slug']}")
custom = [f for f in et.get("bookingFields", []) if not f.get("isDefault")]
print(f"  custom fields: {len(custom)}")
for f in custom:
    print(f"    - {f.get('label')} ({f['type']}, req={f.get('required')})")

# 2. Hide unused event types instead of deleting (reversible)
for et_id, name in [(5752259, "15 min meeting"), (5752258, "Secret meeting")]:
    print(f"\n[2/3] Hiding event {et_id} ({name})...")
    request("PATCH", f"/event-types/{et_id}", {"hidden": True})
    print(f"  ok: hidden")

# 3. Confirm final state
print("\n[3/3] Final event-type listing:")
result = request("GET", "/event-types?username=juan-diaz-d8yrgf")
for et in result["data"]:
    hidden = " (hidden)" if et.get("hidden") else ""
    print(f"  [{et['id']}] {et['title']} - {et['lengthInMinutes']}min - /{et['slug']}{hidden}")

print("\nNew booking URL:  https://cal.com/juan-diaz-d8yrgf/consultation")
