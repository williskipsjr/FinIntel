import { getApiBaseUrl } from "./api";

export function getDownloadUrl(caseId: string, format: "pdf" | "excel" | "docx"): string {
  const baseUrl = getApiBaseUrl();
  return `${baseUrl}/api/v1/reports/${caseId}/${format}`;
}

export function downloadReport(caseId: string, format: "pdf" | "excel" | "docx", filename?: string) {
  const url = getDownloadUrl(caseId, format);
  const a = document.createElement("a");
  a.href = url;
  // The server returns Content-Disposition: attachment, but having download attribute is a good client-side fallback.
  const ext = format === "excel" ? "xlsx" : format;
  a.download = filename || `Forensic_Report_${caseId}.${ext}`;
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export type ServiceReport = "round-trips" | "money-flow" | "money-trail";

/**
 * Download a per-service investigation report (scoped to caseId).
 * `focus` enables selective export: a credit transaction id (money-trail) or a
 * round-trip chain id (round-trips) exports just that single item.
 */
export function downloadServiceReport(
  caseId: string,
  service: ServiceReport,
  format: "pdf" | "excel" | "docx",
  focus?: string | number
) {
  const baseUrl = getApiBaseUrl();
  const focusQs =
    focus !== undefined && focus !== null && `${focus}` !== ""
      ? `?focus=${encodeURIComponent(String(focus))}`
      : "";
  const url = `${baseUrl}/api/v1/reports/${caseId}/service/${service}/${format}${focusQs}`;
  const ext = format === "excel" ? "xlsx" : format;
  const selected = focusQs ? "_selected" : "";
  const a = document.createElement("a");
  a.href = url;
  a.download = `${service.replace("-", "_")}${selected}_report_${caseId}.${ext}`;
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
