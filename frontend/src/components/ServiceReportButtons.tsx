import React from 'react';
import { FileDown } from 'lucide-react';
import { downloadServiceReport, ServiceReport } from '../services/downloads';

// Compact "export this service's report" control (PDF + Word + Excel), reusing
// the app's existing button styling. Scoped to the caller's current caseId.
//
// `focus` enables selective export (a single credit trail or round-trip chain):
// same styling, just a narrower scope + a distinct label so the officer knows
// they're exporting only the selected item.
export function ServiceReportButtons({
  caseId,
  service,
  focus,
  label = 'Export',
}: {
  caseId: string;
  service: ServiceReport;
  focus?: string | number;
  label?: string;
}) {
  const scopeNote = focus !== undefined && focus !== null && `${focus}` !== '' ? ' (selected only)' : '';
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase font-bold text-[#71717A] font-mono pr-1">{label}</span>
      <button
        type="button"
        onClick={() => downloadServiceReport(caseId, service, 'pdf', focus)}
        className="px-2.5 py-1.5 bg-[#18181B] hover:bg-black text-white text-[11px] font-semibold rounded-md flex items-center gap-1.5 cursor-pointer transition-colors"
        title={`Download this report (PDF)${scopeNote}`}
      >
        <FileDown className="w-3 h-3" /> PDF
      </button>
      <button
        type="button"
        onClick={() => downloadServiceReport(caseId, service, 'docx', focus)}
        className="px-2.5 py-1.5 bg-white border border-[#E4E4E7] hover:border-[#18181B] text-[#18181B] text-[11px] font-semibold rounded-md flex items-center gap-1.5 cursor-pointer transition-colors"
        title={`Download this report (Word)${scopeNote}`}
      >
        <FileDown className="w-3 h-3 text-[#52525B]" /> Word
      </button>
      <button
        type="button"
        onClick={() => downloadServiceReport(caseId, service, 'excel', focus)}
        className="px-2.5 py-1.5 bg-white border border-[#E4E4E7] hover:border-[#18181B] text-[#18181B] text-[11px] font-semibold rounded-md flex items-center gap-1.5 cursor-pointer transition-colors"
        title={`Download this report (Excel)${scopeNote}`}
      >
        <FileDown className="w-3 h-3 text-[#52525B]" /> Excel
      </button>
    </div>
  );
}
