#!/usr/bin/env python3
"""
Postfix pipe script for travel@emdm.ch
Receives raw email on stdin, extracts text + PDFs, calls /api/emails/ingest.

Install:
  chmod +x /home/eduardo/waypoint/parse_email.py
  Add to /etc/aliases:  travel: "|/home/eduardo/waypoint/parse_email.py"
  Run: newaliases
"""

import sys
import os
import email
import email.policy
import json
import urllib.request
import urllib.error
import logging
import traceback
import io

# ── Config ───────────────────────────────────────────────────────────────────
API_URL   = "http://localhost:8000/api/emails/ingest"
API_TOKEN = "d5f9e9b215da795ef927a399c3eba355"
LOG_FILE  = "/var/log/waypoint-email.log"
VENV_SITE = "/home/eduardo/waypoint/venv/lib/python3.12/site-packages"

# Add venv to path so pdfplumber is available
if VENV_SITE not in sys.path:
    sys.path.insert(0, VENV_SITE)

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    filename=LOG_FILE,
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("waypoint-email")


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extract text from a PDF attachment using pdfplumber."""
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            pages = []
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    pages.append(text)
            return "\n\n".join(pages)
    except Exception as e:
        log.warning(f"PDF extraction failed: {e}")
        return ""


def extract_body(msg: email.message.Message) -> tuple[str, list[str]]:
    """
    Extract plain text body and any PDF text from a parsed email message.
    Returns (body_text, [pdf_texts]).
    """
    body_parts = []
    pdf_texts  = []

    if msg.is_multipart():
        for part in msg.walk():
            ct   = part.get_content_type()
            disp = str(part.get("Content-Disposition") or "")

            if ct == "text/plain" and "attachment" not in disp:
                charset = part.get_content_charset() or "utf-8"
                try:
                    body_parts.append(part.get_payload(decode=True).decode(charset, errors="replace"))
                except Exception:
                    pass

            elif ct == "application/pdf" or part.get_filename("").lower().endswith(".pdf"):
                pdf_data = part.get_payload(decode=True)
                if pdf_data:
                    pdf_text = extract_text_from_pdf(pdf_data)
                    if pdf_text:
                        pdf_texts.append(pdf_text)

            elif ct == "text/html" and not body_parts:
                # Fallback: strip HTML tags if no plain text found
                charset = part.get_content_charset() or "utf-8"
                try:
                    html = part.get_payload(decode=True).decode(charset, errors="replace")
                    import re
                    plain = re.sub(r"<[^>]+>", " ", html)
                    plain = re.sub(r"\s+", " ", plain).strip()
                    body_parts.append(plain)
                except Exception:
                    pass
    else:
        charset = msg.get_content_charset() or "utf-8"
        try:
            body_parts.append(msg.get_payload(decode=True).decode(charset, errors="replace"))
        except Exception:
            pass

    return "\n\n".join(body_parts), pdf_texts


def call_ingest_api(payload: dict) -> dict:
    """POST to the Waypoint ingest endpoint."""
    data    = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "X-Token":      API_TOKEN,
    }
    req = urllib.request.Request(API_URL, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"API HTTP {e.code}: {body}")


def main():
    # Read raw email from stdin
    raw_email = sys.stdin.buffer.read()
    log.info(f"Received email ({len(raw_email)} bytes)")

    try:
        msg = email.message_from_bytes(raw_email, policy=email.policy.default)
    except Exception as e:
        log.error(f"Failed to parse email: {e}")
        sys.exit(0)  # Exit 0 so Postfix doesn't bounce

    message_id   = str(msg.get("Message-ID", "") or "").strip()
    from_address = str(msg.get("From", "") or "").strip()
    subject      = str(msg.get("Subject", "") or "").strip()

    if not message_id:
        import hashlib, time
        message_id = f"<generated-{hashlib.md5(raw_email).hexdigest()}@waypoint>"

    log.info(f"Processing: message_id={message_id} from={from_address} subject={subject}")

    # Extract body + PDF text
    body_text, pdf_texts = extract_body(msg)

    # Combine body + PDF content
    full_text = body_text
    if pdf_texts:
        full_text += "\n\n--- PDF ATTACHMENT ---\n\n" + "\n\n---\n\n".join(pdf_texts)

    if not full_text.strip():
        log.warning("No text content extracted from email")
        sys.exit(0)

    # Truncate to ~12000 chars to stay within GPT context
    if len(full_text) > 12000:
        full_text = full_text[:12000] + "\n[truncated]"

    # Call the ingest API
    payload = {
        "message_id":   message_id,
        "from_address": from_address,
        "subject":      subject,
        "body_text":    full_text,
    }

    try:
        result = call_ingest_api(payload)
        log.info(f"Ingest result: {result}")
        if result.get("segments_created", 0) > 0:
            log.info(f"✓ Created {result['segments_created']} segment(s) for trip {result.get('trip_id')}")
        else:
            log.warning(f"No segments created: {result.get('parse_status')} — {result.get('error', '')}")
    except Exception as e:
        log.error(f"Ingest API call failed: {e}\n{traceback.format_exc()}")
        # Don't bounce the email — just log and exit cleanly
        sys.exit(0)

    sys.exit(0)


if __name__ == "__main__":
    main()
