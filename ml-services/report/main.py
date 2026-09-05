"""
Report service (Phase 7 / Core Requirement 6).
Generates investigation reports as JSON / Excel / PDF / DOCX.
Run: uvicorn main:app --reload --port 8010
"""

import io
from typing import List, Optional

from fastapi import FastAPI
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from services.report_builder import ReportBuilder
from services.excel_report import build_excel
from services.docx_report import build_docx
from services import email_service
from services import service_reports, generic_render

app = FastAPI()
builder = ReportBuilder()


# (attachment builder, filename, MIME) per requested format
def _render_attachment(report, fmt, case_id):
    fmt = (fmt or "pdf").lower()
    if fmt in ("excel", "xlsx"):
        return (build_excel(report), f"investigation_report_{case_id}.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "excel")
    if fmt in ("docx", "word"):
        return (build_docx(report), f"investigation_report_{case_id}.docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx")
    from services.pdf_report import build_pdf
    return (build_pdf(report), f"investigation_report_{case_id}.pdf",
            "application/pdf", "pdf")


@app.get("/health")
def health():
    return {"service": "report", "status": "healthy"}


def _download(data: bytes, media_type: str, filename: str):
    return StreamingResponse(
        io.BytesIO(data),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/report/{case_id}/json")
def report_json(case_id: str, refresh: bool = False):
    return JSONResponse(builder.build(case_id, refresh=refresh))


@app.get("/report/{case_id}/excel")
def report_excel(case_id: str, refresh: bool = False):
    data = build_excel(builder.build(case_id, refresh=refresh))
    return _download(
        data,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        f"investigation_report_{case_id}.xlsx",
    )


@app.get("/report/{case_id}/docx")
def report_docx(case_id: str, refresh: bool = False):
    data = build_docx(builder.build(case_id, refresh=refresh))
    return _download(
        data,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        f"investigation_report_{case_id}.docx",
    )


@app.get("/report/{case_id}/service/{service}/{fmt}")
def service_report(case_id: str, service: str, fmt: str, focus: Optional[str] = None):
    """Per-service investigation report (round-trips | money-flow | money-trail)
    in json / pdf / excel / docx, scoped to a statement or the whole network.

    `focus` enables selective export: a credit transaction id (money-trail) or a
    round-trip chain id (round-trips) exports just that single item."""
    if service not in service_reports.SERVICES:
        return JSONResponse(status_code=404,
                            content={"error": f"unknown service '{service}'"})
    doc = service_reports.build_service_doc(service, case_id, focus=focus)
    fmt = (fmt or "json").lower()
    tag = service.replace("-", "_")
    if focus:
        tag = f"{tag}_selected"

    if fmt == "json":
        return JSONResponse(doc)
    if fmt in ("excel", "xlsx"):
        return _download(generic_render.render_excel(doc),
                         "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                         f"{tag}_report_{case_id}.xlsx")
    if fmt in ("docx", "word"):
        return _download(generic_render.render_docx(doc),
                         "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                         f"{tag}_report_{case_id}.docx")
    try:
        return _download(generic_render.render_pdf(doc), "application/pdf",
                         f"{tag}_report_{case_id}.pdf")
    except ImportError:
        return JSONResponse(status_code=501,
                            content={"error": "reportlab not installed. Run: pip install reportlab"})


@app.get("/report/{case_id}/pdf")
def report_pdf(case_id: str, refresh: bool = False):
    try:
        from services.pdf_report import build_pdf
        data = build_pdf(builder.build(case_id, refresh=refresh))
    except ImportError:
        return JSONResponse(
            status_code=501,
            content={"error": "reportlab not installed. Run: pip install reportlab"},
        )
    return _download(data, "application/pdf", f"investigation_report_{case_id}.pdf")


class EmailRequest(BaseModel):
    recipients: List[str]
    format: str = "pdf"
    subject: Optional[str] = None
    message: Optional[str] = None
    sender_name: Optional[str] = None


@app.post("/report/{case_id}/email")
def report_email(case_id: str, req: EmailRequest, refresh: bool = False):
    """Build the investigation report and email it as an attachment.

    Returns 200 with {"status": "sent"|"error", ...} so the gateway/frontend can
    surface a precise message (e.g. SMTP not configured) rather than a generic 5xx.
    """
    recipients = [r.strip() for r in (req.recipients or []) if r and r.strip()]
    if not recipients:
        return {"status": "error", "message": "No recipient email addresses provided."}

    if not email_service.is_configured():
        return {"status": "error",
                "message": "Email delivery is not configured on the server "
                           "(set SMTP_HOST / SMTP_FROM / SMTP_USER / SMTP_PASSWORD)."}

    try:
        report = builder.build(case_id, refresh=refresh)
    except Exception as exc:
        return {"status": "error", "message": f"Failed to build report: {exc}"}

    try:
        data, filename, mime, fmt = _render_attachment(report, req.format, case_id)
    except ImportError:
        return {"status": "error",
                "message": "PDF rendering requires reportlab. Run: pip install reportlab"}
    except Exception as exc:
        return {"status": "error", "message": f"Failed to render report: {exc}"}

    scope = report.get("scope") or f"Case {case_id}"
    es = report.get("executive_summary", {}) or {}
    subject = req.subject or f"FinIntel Investigation Report — {scope}"

    intro = (f"{req.sender_name} has shared a FinIntel investigation report."
             if req.sender_name else
             "You have received a FinIntel investigation report.")
    note = f"\n\nMessage:\n{req.message}\n" if req.message else "\n"
    body = (
        f"{intro}{note}\n"
        f"Investigation Summary\n"
        f"---------------------\n"
        f"Scope              : {scope}\n"
        f"Generated          : {report.get('generated_at', 'N/A')}\n"
        f"Statements         : {es.get('statements', 0)}\n"
        f"Transactions       : {es.get('transactions', 0)}\n"
        f"Entities resolved  : {es.get('entities', 0)}\n"
        f"Round trips detected: {es.get('round_trips_detected', 0)}\n"
        f"High-risk accounts : {es.get('high_risk_accounts', 0)}\n\n"
        f"The full investigation report is attached ({fmt.upper()}).\n\n"
        f"— FinIntel OS (automated delivery)"
    )

    try:
        email_service.send_report_email(recipients, subject, body, data, filename, mime)
    except Exception as exc:
        return {"status": "error", "message": f"Failed to send email: {exc}"}

    return {"status": "sent", "recipients": recipients, "format": fmt, "subject": subject}
