"""
SMTP email delivery for investigation reports.

Configuration is entirely environment-driven so no secrets live in code:

  SMTP_HOST       e.g. smtp.gmail.com          (required)
  SMTP_PORT       default 465
  SMTP_USER       login username (often = from address)
  SMTP_PASSWORD   login password / app-password
  SMTP_FROM       From address (defaults to SMTP_USER)
  SMTP_USE_TLS    "true" (STARTTLS on 587) | "false" (SSL on 465, default)

If SMTP isn't configured the caller gets a clear, actionable error instead of a
silent failure.

Delivery is self-healing: it tries the configured transport, and on a transient
TLS/connection failure (e.g. a VPN / Zero-Trust proxy such as Cloudflare WARP
truncating a handshake -> `ssl.SSLError: [ASN1: NOT_ENOUGH_DATA]`) it falls back
to the *other* Gmail transport (SSL/465 <-> STARTTLS/587). Auth / recipient
errors are surfaced immediately (no pointless retry or fallback).
"""

import os
import smtplib
import socket
import ssl
import time
from email.message import EmailMessage
from pathlib import Path


def _load_dotenv_once():
    """Populate os.environ from a `.env` file next to the report service, if
    present. Stdlib-only (no python-dotenv dependency) — existing environment
    variables always win, so a real deployment's env still overrides the file.
    Safe to call repeatedly; only ever sets keys that aren't already set."""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv_once()


def _bool(value, default=True):
    if value is None:
        return default
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def is_configured() -> bool:
    return bool(os.getenv("SMTP_HOST") and (os.getenv("SMTP_FROM") or os.getenv("SMTP_USER")))


# Transient connection/TLS errors worth one retry (e.g. a VPN or antivirus
# SSL-inspection proxy occasionally truncates the STARTTLS handshake, surfacing
# as `ssl.SSLError: [ASN1: NOT_ENOUGH_DATA]`). Auth/recipient errors are NOT
# retried — retrying those would just fail again with the same cause.
_TRANSIENT_ERRORS = (ssl.SSLError, socket.timeout, socket.gaierror,
                    ConnectionError, smtplib.SMTPConnectError,
                    smtplib.SMTPServerDisconnected)


def _deliver(host, port, use_tls, user, password, msg):
    """One delivery over a single transport (SSL if use_tls is False, else STARTTLS)."""
    context = ssl.create_default_context()
    if use_tls:
        with smtplib.SMTP(host, port, timeout=30) as server:
            server.starttls(context=context)
            if user and password:
                server.login(user, password)
            server.send_message(msg)
    else:
        with smtplib.SMTP_SSL(host, port, context=context, timeout=30) as server:
            if user and password:
                server.login(user, password)
            server.send_message(msg)


def _transport_plan(port, use_tls):
    """Configured transport first, then the alternate (SSL/465 <-> STARTTLS/587)."""
    primary = (port, use_tls)
    alternate = (587, True) if not use_tls else (465, False)
    return [primary] if primary == alternate else [primary, alternate]


def send_report_email(recipients, subject, body, attachment_bytes,
                      attachment_name, attachment_mime, max_attempts: int = 2):
    host = os.getenv("SMTP_HOST")
    from_addr = os.getenv("SMTP_FROM") or os.getenv("SMTP_USER")
    if not host or not from_addr:
        raise RuntimeError(
            "Email is not configured on the server. Set SMTP_HOST and SMTP_FROM "
            "(plus SMTP_USER / SMTP_PASSWORD) in the report service environment."
        )

    port = int(os.getenv("SMTP_PORT", "465"))
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    use_tls = _bool(os.getenv("SMTP_USE_TLS"), default=(port == 587))

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(recipients)
    msg.set_content(body)

    maintype, _, subtype = attachment_mime.partition("/")
    msg.add_attachment(
        attachment_bytes,
        maintype=maintype or "application",
        subtype=subtype or "octet-stream",
        filename=attachment_name,
    )

    last_err = None
    for (t_port, t_tls) in _transport_plan(port, use_tls):
        for attempt in range(1, max_attempts + 1):
            try:
                _deliver(host, t_port, t_tls, user, password, msg)
                return
            except _TRANSIENT_ERRORS as exc:
                last_err = exc
                if attempt < max_attempts:
                    time.sleep(1.0 * attempt)  # brief backoff, then retry
                # else: fall through to the next transport
            except Exception as exc:
                # auth / recipient / message errors won't be fixed by retrying
                raise RuntimeError(f"Failed to send email: {exc}") from exc

    raise RuntimeError(
        f"SMTP delivery failed on all transports (transient network/TLS issue): {last_err}"
    )
