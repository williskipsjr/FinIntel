import React, { useState, useEffect, useCallback } from 'react';
import { 
  FileDown, 
  CheckCircle, 
  RefreshCw, 
  AlertTriangle, 
  FileText, 
  ChevronDown, 
  Check, 
  Copy, 
  ArrowRight, 
  ShieldAlert, 
  Layers, 
  TrendingUp, 
  Calendar, 
  Database,
  Loader2,
  Mail,
  X,
  Send,
  MapPin
} from 'lucide-react';
import { useFinintelData } from '../context/FinintelDataContext';
import {
  getReportJson,
  getStatementTransactions,
  getRoundTrips,
  getTopSuspicious,
  emailReport
} from '../services/finintelApi';
import { ChannelDonut, ChannelBars, VelocityChart } from './ReportCharts';
import { downloadReport } from '../services/downloads';
import { getSession } from '../services/auth';
import { RiskBadges } from './RiskBadge';
import { RoundTrip } from '../types/api';

export default function ReportsPage() {
  const { caseId, setCaseId, latestStatementId, caseSummary, statements = [] } = useFinintelData();

  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Email report modal state
  const [isEmailOpen, setIsEmailOpen] = useState(false);
  const [emailRecipients, setEmailRecipients] = useState('');
  const [emailFormat, setEmailFormat] = useState<'pdf' | 'excel' | 'docx'>('pdf');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailResult, setEmailResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleSendEmail = async () => {
    setEmailResult(null);
    const recipients = emailRecipients
      .split(/[\s,;]+/)
      .map((r) => r.trim())
      .filter(Boolean);
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalid = recipients.filter((r) => !emailRe.test(r));
    if (recipients.length === 0) {
      setEmailResult({ ok: false, msg: 'Enter at least one recipient email address.' });
      return;
    }
    if (invalid.length > 0) {
      setEmailResult({ ok: false, msg: `Invalid email(s): ${invalid.join(', ')}` });
      return;
    }
    setIsSendingEmail(true);
    try {
      const res = await emailReport(caseId, {
        recipients,
        format: emailFormat,
        subject: emailSubject.trim() || undefined,
        message: emailMessage.trim() || undefined,
        sender_name: getSession()?.name || undefined,
      });
      if (res?.status === 'sent') {
        setEmailResult({ ok: true, msg: `Report emailed to ${recipients.length} recipient(s).` });
        setSuccessMessage(`Investigation report emailed to ${recipients.join(', ')}.`);
        setTimeout(() => setSuccessMessage(null), 4000);
        setTimeout(() => setIsEmailOpen(false), 1200);
      } else {
        setEmailResult({ ok: false, msg: res?.message || 'Failed to send report email.' });
      }
    } catch (err: any) {
      setEmailResult({ ok: false, msg: err?.message || 'Failed to send report email.' });
    } finally {
      setIsSendingEmail(false);
    }
  };

  // Custom Scope dropdown state
  const [isScopeDropdownOpen, setIsScopeDropdownOpen] = useState(false);

  // Live report dashboard states
  const [reportJson, setReportJson] = useState<any>(null);
  const [suspiciousTxs, setSuspiciousTxs] = useState<any[]>([]);
  const [suspiciousAccounts, setSuspiciousAccounts] = useState<any[]>([]);
  const [roundTripsList, setRoundTripsList] = useState<RoundTrip[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Copy indicators
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadReportData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setReportJson(null);
    setSuspiciousTxs([]);
    setSuspiciousAccounts([]);
    setRoundTripsList([]);
    try {
      // 1. Fetch Executive Report JSON
      const data = await getReportJson(caseId);
      setReportJson(data);
      
      const txs = data?.suspicious_transactions || data?.transactions || [];
      if (txs.length > 0) {
        setSuspiciousTxs(txs);
      } else if (caseId && caseId !== 'all') {
        const stmtTxs = await getStatementTransactions(caseId, 1, 30);
        const suspicious = stmtTxs.filter(t => t.is_failed || !t.is_valid || (t.confidence_score !== null && t.confidence_score < 0.9));
        setSuspiciousTxs(suspicious.length > 0 ? suspicious : stmtTxs.slice(0, 5));
      }

      // 2. Top suspicious accounts — own try so a failure never blocks the
      //    rest of the brief; fall back to the report's own top_risks list.
      let accounts: any[] = [];
      try {
        const suspiciousResponse = await getTopSuspicious(caseId, 12);
        accounts = suspiciousResponse?.accounts || [];
      } catch (_) { /* fall through to report top_risks */ }
      if (accounts.length === 0 && Array.isArray(data?.top_risks)) {
        accounts = data.top_risks.map((r: any) => ({
          account: r.node ?? r.account,
          type: r.type,
          risk_score: r.risk_score,
          risk_level: r.risk_level,
          patterns: r.patterns ?? r.top_reasons ?? [],
        }));
      }
      setSuspiciousAccounts(accounts);

      // 3. Round trips (fall back to the report's embedded round_trips)
      try {
        const roundTripsResponse = await getRoundTrips(caseId);
        setRoundTripsList(roundTripsResponse?.round_trips || data?.round_trips || []);
      } catch (_) {
        setRoundTripsList(data?.round_trips || []);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load report preview from gateway.");
      
      // Fallback populated locally if microservices are down
      if (caseId && caseId !== 'all') {
        try {
          const stmtTxs = await getStatementTransactions(caseId, 1, 10);
          setSuspiciousTxs(stmtTxs.slice(0, 5));
        } catch (_) {}
      }
    } finally {
      setIsLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    loadReportData();
  }, [loadReportData]);

  const handleExportPDF = () => {
    setIsExportingPDF(true);
    setSuccessMessage(null);
    try {
      downloadReport(caseId, 'pdf');
      setSuccessMessage("PDF Report successfully compiled and downloaded.");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      console.error("PDF download failed:", err);
    } finally {
      setIsExportingPDF(false);
    }
  };

  const handleExportExcel = () => {
    setIsExportingExcel(true);
    setSuccessMessage(null);
    try {
      downloadReport(caseId, 'excel');
      setSuccessMessage("Excel Spreadsheet successfully compiled and downloaded.");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      console.error("Excel download failed:", err);
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleExportDocx = () => {
    setIsExportingDocx(true);
    setSuccessMessage(null);
    try {
      downloadReport(caseId, 'docx');
      setSuccessMessage("Word DOCX Document successfully compiled and downloaded.");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      console.error("DOCX download failed:", err);
    } finally {
      setIsExportingDocx(false);
    }
  };

  const copyToClipboard = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatCurrency = (val: any) => {
    const num = Number(val) || 0;
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(num);
  };

  const safeSlice = (str: any, start: number, end: number) => {
    if (typeof str !== 'string') return '';
    return str.slice(start, end);
  };

  // Derived report sections (from the backend report model)
  const es = reportJson?.executive_summary || null;
  const mf = reportJson?.money_flow || null;
  const recommendations: string[] = Array.isArray(reportJson?.recommendations)
    ? reportJson.recommendations
    : [];

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8 animate-fade-in select-none">
      
      {/* Upper toolbar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-[#E4E4E7] pb-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-[#18181B] font-display">Investigation Report</h1>
          <p className="text-sm text-[#71717A] font-light font-sans">Certified compliance and forensic brief compilation.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          {/* Custom Case Scope Dropdown Selector */}
          <div className={`relative self-start shrink-0 ${isScopeDropdownOpen ? 'z-50' : 'z-30'}`}>
            {isScopeDropdownOpen && (
              <div className="fixed inset-0 z-40" onClick={() => setIsScopeDropdownOpen(false)} />
            )}
            <button
              type="button"
              onClick={() => setIsScopeDropdownOpen(!isScopeDropdownOpen)}
              className="flex items-center justify-between gap-2.5 bg-white border border-[#E4E4E7] hover:border-zinc-400 rounded-lg p-2 px-3 text-xs font-semibold text-zinc-950 shadow-xs cursor-pointer min-w-[170px] relative transition-all"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase font-bold text-[#71717A] font-mono pr-2 border-r border-[#E4E4E7]">Scope</span>
                <span className="truncate max-w-[130px] font-medium text-zinc-900">
                  {caseId === 'all' 
                    ? 'Whole Network (all)' 
                    : `Current Statement (${safeSlice(caseId, 0, 8)}...)`}
                </span>
              </div>
              <ChevronDown className="w-3 h-3 text-[#71717A] ml-1" />
            </button>
            
            {isScopeDropdownOpen && (
              <div className="absolute right-0 mt-1.5 w-64 bg-white border border-[#E4E4E7] rounded-xl shadow-lg z-50 py-1.5 max-h-60 overflow-y-auto animate-fade-in">
                <button
                  type="button"
                  onClick={() => {
                    setCaseId('all');
                    setIsScopeDropdownOpen(false);
                  }}
                  className={`w-full text-left px-3.5 py-2 text-xs transition-colors flex items-center justify-between hover:bg-[#FAF9F6] ${
                    caseId === 'all' ? 'bg-zinc-50 font-bold text-[#18181B]' : 'text-zinc-700 font-light'
                  }`}
                >
                  <span>Whole Network (all)</span>
                  {caseId === 'all' && <Check className="w-3.5 h-3.5 text-zinc-800" />}
                </button>
                
                {latestStatementId && (
                  <button
                    type="button"
                    onClick={() => {
                      setCaseId(latestStatementId);
                      setIsScopeDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3.5 py-2 text-xs transition-colors flex items-center justify-between hover:bg-[#FAF9F6] ${
                      caseId === latestStatementId ? 'bg-zinc-50 font-bold text-[#18181B]' : 'text-zinc-700 font-light'
                    }`}
                  >
                    <span>Current Statement ({safeSlice(latestStatementId, 0, 8)}...)</span>
                    {caseId === latestStatementId && <Check className="w-3.5 h-3.5 text-zinc-800" />}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Action triggers */}
          <div className="flex gap-2.5 w-full sm:w-auto">
            <button
              onClick={() => { setEmailResult(null); setIsEmailOpen(true); }}
              disabled={isLoading}
              className="flex-1 sm:flex-initial px-3.5 py-2 bg-white border border-[#E4E4E7] hover:border-[#18181B] text-[#18181B] text-xs font-semibold rounded-md flex items-center justify-center gap-2 transition-colors cursor-pointer font-sans disabled:opacity-50"
            >
              <Mail className="w-3.5 h-3.5 text-[#52525B]" />
              <span>Email</span>
            </button>

            <button
              onClick={handleExportExcel}
              disabled={isExportingExcel || isExportingPDF || isExportingDocx || isLoading}
              className="flex-1 sm:flex-initial px-3.5 py-2 bg-white border border-[#E4E4E7] hover:border-[#18181B] text-[#18181B] text-xs font-semibold rounded-md flex items-center justify-center gap-2 transition-colors cursor-pointer font-sans disabled:opacity-50"
            >
              {isExportingExcel ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#71717A]" />
              ) : (
                <FileDown className="w-3.5 h-3.5 text-[#52525B]" />
              )}
              <span>Excel</span>
            </button>

            <button
              onClick={handleExportDocx}
              disabled={isExportingExcel || isExportingPDF || isExportingDocx || isLoading}
              className="flex-1 sm:flex-initial px-3.5 py-2 bg-white border border-[#E4E4E7] hover:border-[#18181B] text-[#18181B] text-xs font-semibold rounded-md flex items-center justify-center gap-2 transition-colors cursor-pointer font-sans disabled:opacity-50"
            >
              {isExportingDocx ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#71717A]" />
              ) : (
                <FileDown className="w-3.5 h-3.5 text-[#52525B]" />
              )}
              <span>Word</span>
            </button>

            <button
              onClick={handleExportPDF}
              disabled={isExportingExcel || isExportingPDF || isExportingDocx || isLoading}
              className="flex-1 sm:flex-initial px-3.5 py-2 bg-[#18181B] hover:bg-black text-white text-xs font-semibold rounded-md flex items-center justify-center gap-2 transition-colors cursor-pointer font-sans disabled:opacity-50"
            >
              {isExportingPDF ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
              ) : (
                <FileDown className="w-3.5 h-3.5 text-white" />
              )}
              <span>PDF Report</span>
            </button>
          </div>
        </div>
      </div>

      {/* Dynamic Feedback indicator */}
      {successMessage && (
        <div className="p-3 bg-[#ECFDF5] border border-[#A7F3D0] text-[#065F46] rounded-lg text-xs font-bold flex items-center gap-2 animate-fade-in font-sans">
          <CheckCircle className="w-4 h-4 text-[#10B981]" />
          <span>{successMessage}</span>
        </div>
      )}

      {isLoading ? (
        <div className="h-[36rem] border border-[#E4E4E7] bg-white rounded-xl flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-zinc-800" />
          <p className="text-xs text-[#71717A] font-light">Compiling global case brief logs...</p>
        </div>
      ) : (
        /* Primary Report Dashboard Layout */
        <div className="space-y-6">

          {/* Malicious-activity flags roll-up (top-of-report) */}
          {reportJson?.flags_summary && (
            <div className={`p-3 rounded-lg border text-xs font-bold flex items-center gap-2 ${
              (reportJson.flagged_findings?.length ?? 0) > 0
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]'
            }`}>
              {(reportJson.flagged_findings?.length ?? 0) > 0
                ? <ShieldAlert className="w-4 h-4 shrink-0" />
                : <CheckCircle className="w-4 h-4 shrink-0" />}
              <span>{reportJson.flags_summary}</span>
            </div>
          )}

          {/* Executive Case Brief Summary */}
          <div className="bg-white border border-[#E4E4E7] p-5 rounded-xl space-y-2">
            <h2 className="text-xs font-bold text-[#18181B] uppercase tracking-wider border-b border-[#E4E4E7] pb-2 font-mono flex justify-between items-center">
              <span>Investigation Summary Brief</span>
              {error && (
                <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 uppercase font-mono">
                  Offline Fallback
                </span>
              )}
            </h2>
            <p className="text-xs text-[#52525B] leading-relaxed font-light mt-2">
              {es
                ? `This forensic brief consolidates ${Number(es.transactions || 0).toLocaleString('en-IN')} transaction(s) across ${es.statements || 1} statement file(s), resolving ${es.entities || 0} entities. The audit isolated ${es.round_trips_detected ?? 0} circular (round-trip) flow(s) and flagged ${es.high_risk_accounts ?? 0} high-risk account(s). Total volume processed: ${formatCurrency(es.total_credit || 0)} credited and ${formatCurrency(es.total_debit || 0)} debited.`
                : `This forensic brief consolidates financial flow metrics identified across the case. Total volume processed is ${formatCurrency(caseSummary?.total_credit || 0)} credits and ${formatCurrency(caseSummary?.total_debit || 0)} debits across ${caseSummary?.statements || 1} statement file(s).`}
            </p>
          </div>

          {/* Key Insights — metric cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Transactions', value: Number(es?.transactions ?? caseSummary?.transactions ?? 0).toLocaleString('en-IN'), Icon: Database, tone: 'text-zinc-900' },
              { label: 'Round-Trip Loops', value: String(es?.round_trips_detected ?? roundTripsList.length ?? 0), Icon: RefreshCw, tone: 'text-red-600' },
              { label: 'High-Risk Accounts', value: String(es?.high_risk_accounts ?? suspiciousAccounts.length ?? 0), Icon: ShieldAlert, tone: 'text-amber-600' },
              { label: 'Credited Volume', value: formatCurrency(es?.total_credit ?? caseSummary?.total_credit ?? 0), Icon: TrendingUp, tone: 'text-emerald-700' },
            ].map((card, i) => (
              <div key={i} className="bg-white border border-[#E4E4E7] rounded-xl p-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#71717A]">{card.label}</span>
                  <card.Icon className={`w-3.5 h-3.5 ${card.tone}`} />
                </div>
                <p className={`text-lg font-bold mt-2 ${card.tone} font-display`}>{card.value}</p>
              </div>
            ))}
          </div>

          {/* Key Findings + Investigator Recommendations */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-[#E4E4E7] rounded-xl p-5 space-y-3">
              <h3 className="text-xs font-bold text-[#18181B] uppercase tracking-wider font-mono border-b border-[#F4F4F5] pb-2 flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-zinc-700" /> Key Findings
              </h3>
              <ul className="space-y-2 text-xs text-[#52525B] font-light">
                {mf?.destination_account && (
                  <li className="flex gap-2"><ArrowRight className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" /><span>Funds accumulate at destination account <span className="font-mono font-bold text-zinc-900">{mf.destination_account}</span>.</span></li>
                )}
                {Array.isArray(mf?.accumulation_accounts) && mf.accumulation_accounts[0] && (
                  <li className="flex gap-2"><ArrowRight className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" /><span>Top collector <span className="font-mono font-bold text-zinc-900">{mf.accumulation_accounts[0].node}</span> received {formatCurrency(mf.accumulation_accounts[0].total_received || 0)} from {mf.accumulation_accounts[0].sender_count || 0} sender(s).</span></li>
                )}
                {roundTripsList.length > 0 && (
                  <li className="flex gap-2"><ArrowRight className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" /><span>{roundTripsList.length} circular (round-trip) chain(s) detected across the network.</span></li>
                )}
                {suspiciousAccounts.length > 0 && (
                  <li className="flex gap-2"><ArrowRight className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" /><span>{suspiciousAccounts.length} account(s) ranked by fused risk score.</span></li>
                )}
                {(!mf?.destination_account && roundTripsList.length === 0 && suspiciousAccounts.length === 0) && (
                  <li className="text-zinc-400">No structural red flags detected in the current scope.</li>
                )}
              </ul>
            </div>

            <div className="bg-white border border-[#E4E4E7] rounded-xl p-5 space-y-3">
              <h3 className="text-xs font-bold text-[#18181B] uppercase tracking-wider font-mono border-b border-[#F4F4F5] pb-2 flex items-center gap-2">
                <ShieldAlert className="w-3.5 h-3.5 text-indigo-600" /> Investigator Recommendations
              </h3>
              {recommendations.length > 0 ? (
                <ul className="space-y-2.5 text-xs text-[#3F3F46] font-light">
                  {recommendations.map((rec, i) => (
                    <li key={i} className="flex gap-2.5 leading-relaxed">
                      <span className="w-5 h-5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-bold flex items-center justify-center shrink-0 border border-indigo-100">{i + 1}</span>
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-zinc-400 font-light py-4">No recommendations generated for this scope.</p>
              )}
            </div>
          </div>

          {/* Dual Column Layout for Top Suspicious Accounts and Statement Directory */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            
            {/* Left Column: Top Suspicious Entities */}
            <div className="lg:col-span-7 bg-white border border-[#E4E4E7] rounded-xl p-5 flex flex-col space-y-4 shadow-xs">
              <div className="border-b border-[#F4F4F5] pb-3">
                <h3 className="text-xs font-bold text-[#18181B] uppercase tracking-wider font-mono">
                  Top Suspicious Entities & Risk Profiles
                </h3>
                <p className="text-[11px] text-[#71717A] mt-1 font-light font-sans">
                  Entities ranked by risk score derived from transaction volume, centrality centrality, and anomalies.
                </p>
              </div>

              {/* Scrollable Suspicious accounts list panel */}
              <div className="flex-1 overflow-y-auto max-h-[30rem] pr-1 space-y-3">
                {suspiciousAccounts.length === 0 ? (
                  <div className="py-12 text-center text-xs text-zinc-400 font-light">
                    No suspicious entity records compiled.
                  </div>
                ) : (
                  suspiciousAccounts.map((acct, idx) => {
                    const acctName = acct?.account || '';
                    return (
                      <div 
                        key={idx}
                        className="border border-[#E4E4E7] rounded-xl p-4 bg-[#FAF9F6] space-y-3 text-xs"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            {/* Entity Identifier */}
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-[#18181B] truncate max-w-[180px]" title={acctName}>
                                {acctName}
                              </span>
                              {acctName && (
                                <button
                                  onClick={() => copyToClipboard(acctName)}
                                  className="text-[#2563EB] hover:text-blue-700 font-medium font-sans cursor-pointer text-[10px]"
                                >
                                  {copiedId === acctName ? 'Copied' : 'Copy'}
                                </button>
                              )}
                            </div>
                            
                            <span className="text-[8.5px] uppercase font-mono font-bold px-1.5 py-0.5 bg-zinc-100 text-zinc-600 rounded mt-1.5 inline-block">
                              {acct?.type || 'ACCOUNT'}
                            </span>
                          </div>

                          {/* Risk Metrics */}
                          <div className="text-right shrink-0">
                            <span className={`text-[9px] uppercase font-bold font-mono px-2 py-0.5 rounded ${
                              acct?.risk_level === 'CRITICAL' ? 'bg-red-100 text-red-800 border border-red-300' :
                              acct?.risk_level === 'HIGH' ? 'bg-red-50 text-red-700 border border-red-200' :
                              acct?.risk_level === 'MEDIUM' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                              acct?.risk_level === 'LOW' ? 'bg-green-50 text-green-700 border border-green-200' :
                              'bg-zinc-100 text-zinc-600 border border-zinc-200'
                            }`}>
                              {acct?.risk_level || 'LOW'} · {Math.round((acct?.risk_score ?? 0) <= 1 ? (acct?.risk_score ?? 0) * 100 : (acct?.risk_score ?? 0))}
                            </span>
                          </div>
                        </div>

                        {/* Malicious-activity flags */}
                        {Array.isArray(acct?.tags) && acct.tags.length > 0 && (
                          <RiskBadges tags={acct.tags} size="xs" />
                        )}

                        {/* Source Statement IDs */}
                        {Array.isArray(acct?.statement_ids) && acct.statement_ids.length > 0 && (
                          <div className="border-t border-b border-[#F4F4F5] py-2 flex flex-wrap items-center gap-1.5">
                            <span className="text-[9px] font-bold text-[#71717A] uppercase font-mono">Source Statements:</span>
                            {acct.statement_ids.map((sid: string, sIdx: number) => {
                              const sidStr = String(sid || '');
                              return (
                                <div 
                                  key={sIdx}
                                  className="inline-flex items-center gap-1 bg-white border border-[#E4E4E7] rounded px-1.5 py-0.5 font-mono text-[9px] text-zinc-700 hover:border-[#18181B] transition-colors cursor-pointer"
                                  onClick={() => copyToClipboard(sidStr)}
                                >
                                  <span className="truncate max-w-[80px]" title={sidStr}>{sidStr}</span>
                                  <span className="text-[8px] text-indigo-600 font-sans font-bold">
                                    {copiedId === sidStr ? 'Copied' : 'Copy'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Risk factors bullet list */}
                        {Array.isArray(acct?.patterns) && acct.patterns.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[9px] font-bold text-[#71717A] uppercase font-mono">Risk Indicators:</span>
                            <ul className="list-disc list-inside text-[10.5px] text-zinc-600 font-light space-y-0.5">
                              {acct.patterns.map((reason: string, rIdx: number) => (
                                <li key={rIdx}>{reason}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Column: Statement Directory + Closed Loop cycles */}
            <div className="lg:col-span-5 flex flex-col gap-6">
              
              {/* Ingested Statements directory list */}
              <div className="bg-white border border-[#E4E4E7] rounded-xl p-5 flex flex-col space-y-4 shadow-xs">
                <div className="border-b border-[#F4F4F5] pb-2">
                  <h3 className="text-xs font-bold text-[#18181B] uppercase tracking-wider font-mono">
                    Ingested Ledger Directory ({statements.length})
                  </h3>
                </div>

                <div className="overflow-y-auto max-h-[12.5rem] pr-1 space-y-2">
                  {statements.map((stmt) => {
                    const stmtIdStr = stmt?.id ? String(stmt.id) : '';
                    return (
                      <div 
                        key={stmtIdStr}
                        className="p-3 border border-[#E4E4E7] rounded-lg bg-[#FAF9F6] flex flex-col justify-between gap-1 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FileText className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                            <span className="font-bold text-zinc-950 truncate max-w-[130px]" title={stmt?.filename || ''}>
                              {stmt?.filename || 'Untitled Statement'}
                            </span>
                          </div>
                          <span className={`text-[8px] font-bold uppercase font-mono px-1.5 py-0.5 rounded ${
                            stmt?.status === 'completed' ? 'bg-green-50 text-green-700 border border-green-200' :
                            stmt?.status === 'failed' ? 'bg-red-50 text-red-700 border border-red-200' :
                            'bg-amber-50 text-amber-700 border border-amber-200 animate-pulse'
                          }`}>
                            {stmt?.status || 'queued'}
                          </span>
                        </div>

                        <div className="border-t border-[#E4E4E7]/60 pt-2 flex items-center justify-between text-[9px] font-mono text-[#71717A]">
                          <div className="flex items-center gap-1">
                            <span>Stmt ID:</span>
                            <span className="font-bold text-zinc-800 select-all">
                              {stmtIdStr ? `${safeSlice(stmtIdStr, 0, 10)}...` : 'N/A'}
                            </span>
                            {stmtIdStr && (
                              <button
                                onClick={() => copyToClipboard(stmtIdStr)}
                                className="text-[#2563EB] hover:text-blue-700 font-sans font-bold cursor-pointer"
                              >
                                {copiedId === stmtIdStr ? 'Copied' : 'Copy'}
                              </button>
                            )}
                          </div>
                          {stmt?.bank_name && <span>{stmt.bank_name}</span>}
                        </div>
                      </div>
                    );
                  })}
                  {statements.length === 0 && (
                    <p className="text-[11px] text-[#71717A] font-light text-center py-6">
                      No statement records uploaded.
                    </p>
                  )}
                </div>
              </div>

              {/* Suspicious Circular Loops List */}
              <div className="bg-white border border-[#E4E4E7] rounded-xl p-5 flex flex-col space-y-4 shadow-xs flex-1">
                <div className="border-b border-[#F4F4F5] pb-2">
                  <h3 className="text-xs font-bold text-[#18181B] uppercase tracking-wider font-mono">
                    Detected Round Trips ({roundTripsList.length})
                  </h3>
                </div>

                <div className="overflow-y-auto max-h-[14rem] pr-1 space-y-2">
                  {roundTripsList.map((trip, idx) => {
                    const nodesList = trip?.nodes || [];
                    const cyclePath = nodesList.join(" ➔ ");
                    
                    // Extract statement ID from the cycle
                    let stmtId: string | null = null;
                    for (const node of nodesList) {
                      if (node && typeof node === 'string' && node.startsWith("STMT:")) {
                        stmtId = node.replace("STMT:", "");
                        break;
                      }
                    }

                    return (
                      <div 
                        key={idx}
                        className="p-3 border border-[#E4E4E7] rounded-lg bg-[#FAF9F6] space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 text-[9px] font-extrabold uppercase font-mono px-1.5 py-0.5 bg-red-50 text-red-700 border border-red-200 rounded">
                              Cycle #{trip?.id ?? idx + 1}
                            </span>
                            <RiskBadges tags={[{ key: 'CIRCULAR', label: 'Circular Money Flow' }]} size="xs" />
                          </div>
                          <span className="font-bold text-[#C2410C] font-mono">
                            {formatCurrency(trip?.min_amount || trip?.total_amount || 0)}
                          </span>
                        </div>

                        <p className="font-mono text-[9px] text-[#52525B] leading-normal break-all bg-white border border-zinc-150 p-1.5 rounded">
                          {cyclePath}
                        </p>

                        <div className="flex items-center justify-between text-[9px] font-mono text-[#71717A] border-t border-[#E4E4E7]/60 pt-1.5">
                          <span>Hops: <strong className="font-sans text-zinc-950 font-bold">{trip?.hops || nodesList.length}</strong></span>
                          {stmtId ? (
                            <div className="flex items-center gap-1">
                              <span>Stmt ID:</span>
                              <span className="font-bold text-zinc-800">{safeSlice(stmtId, 0, 10)}...</span>
                              <button
                                onClick={() => copyToClipboard(stmtId!)}
                                className="text-[#2563EB] hover:text-blue-700 font-sans font-bold cursor-pointer"
                              >
                                {copiedId === stmtId ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                          ) : (
                            <span>Scope: Whole Network</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {roundTripsList.length === 0 && (
                    <p className="text-[11px] text-[#71717A] font-light text-center py-8">
                      No circular transfer loop cycles detected.
                    </p>
                  )}
                </div>
              </div>

            </div>

          </div>

          {/* Payment channels & category breakdown — counts + visual charts */}
          {(Array.isArray(reportJson?.channel_breakdown) && reportJson.channel_breakdown.length > 0) && (
            <div className="space-y-4 font-sans">
              <h2 className="text-xs font-bold text-[#18181B] uppercase tracking-wider border-b border-[#E4E4E7] pb-2 font-mono flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-[#2563EB]" /> Transaction Channels & Categories
              </h2>

              {/* Category headline tiles */}
              {reportJson?.category_counts && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                  {([
                    ['Total', 'total_transactions'],
                    ['ATM Withdrawals', 'atm_withdrawals'],
                    ['Cash Deposits', 'cash_deposits'],
                    ['Failed / Reversed', 'failed_transactions'],
                    ['Digital (UPI/apps)', 'digital_upi'],
                    ['Cheque', 'cheque'],
                  ] as [string, string][]).map(([label, key]) => (
                    <div key={key} className="border border-[#E4E4E7] rounded-xl p-3 bg-white">
                      <div className="text-[9px] uppercase font-bold text-[#71717A] font-mono">{label}</div>
                      <div className="text-xl font-bold text-[#18181B] mt-1 font-display">
                        {reportJson.category_counts[key] ?? 0}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Donut: share by channel */}
                <div className="border border-[#E4E4E7] rounded-xl p-4 bg-white">
                  <div className="text-[10px] uppercase font-bold text-[#71717A] font-mono mb-3">Share by Channel</div>
                  <ChannelDonut data={reportJson.channel_breakdown} />
                </div>
                {/* Bars: class-wise counts (BLKRTGS / NEFT / Paytm / ...) */}
                <div className="border border-[#E4E4E7] rounded-xl p-4 bg-white">
                  <div className="text-[10px] uppercase font-bold text-[#71717A] font-mono mb-3">Class-wise Transaction Counts</div>
                  <ChannelBars data={reportJson.channel_breakdown} />
                </div>
              </div>

              {/* Fund velocity over time */}
              {Array.isArray(reportJson?.activity_timeline) && reportJson.activity_timeline.length > 1 && (
                <div className="border border-[#E4E4E7] rounded-xl p-4 bg-white">
                  <div className="text-[10px] uppercase font-bold text-[#71717A] font-mono mb-2 flex items-center gap-1.5">
                    <TrendingUp className="w-3 h-3 text-[#2563EB]" /> Fund Velocity Over Time
                  </div>
                  <VelocityChart data={reportJson.activity_timeline} />
                </div>
              )}
            </div>
          )}

          {/* Cash Withdrawal / Deposit Locations — physical leads for officers */}
          {Array.isArray(reportJson?.cash_locations) && reportJson.cash_locations.length > 0 && (
            <div className="space-y-3 font-sans">
              <h2 className="text-xs font-bold text-[#18181B] uppercase tracking-wider border-b border-[#E4E4E7] pb-2 font-mono flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-[#DC2626]" /> Cash Withdrawal / Deposit Locations
              </h2>
              <div className="overflow-hidden border border-[#E4E4E7] rounded-xl text-xs">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-[#FAF9F6] border-b border-[#E4E4E7] text-[10px] uppercase font-bold text-[#71717A] font-mono">
                      <th className="p-3 pl-4">City</th>
                      <th className="p-3">State</th>
                      <th className="p-3">Type</th>
                      <th className="p-3">Date / Time</th>
                      <th className="p-3 text-right pr-4">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4E4E7] bg-white">
                    {reportJson.cash_locations.slice(0, 50).map((c: any, idx: number) => (
                      <tr key={idx} className="hover:bg-[#FAFAFA]">
                        <td className="p-3 pl-4 font-bold text-[#18181B] flex items-center gap-1.5">
                          <MapPin className="w-3 h-3 text-[#DC2626] shrink-0" />{c.city}
                        </td>
                        <td className="p-3 text-[#52525B]">{c.state}</td>
                        <td className="p-3">
                          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${c.direction === 'DEBIT' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                            {c.direction === 'DEBIT' ? 'Withdrawal' : 'Deposit'}
                          </span>
                        </td>
                        <td className="p-3 font-mono text-[10px] text-[#71717A]">{c.date || 'N/A'}{c.time ? ` · ${c.time}` : ''}</td>
                        <td className="p-3 text-right font-bold pr-4 text-[#18181B] font-mono">{formatCurrency(c.amount || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Module 4: Suspicious Raw Transactions Log */}
          <div className="space-y-3 font-sans">
            <h2 className="text-xs font-bold text-[#18181B] uppercase tracking-wider border-b border-[#E4E4E7] pb-2 font-mono">
              Suspicious Ledger Transactions Audit Log
            </h2>
            
            {suspiciousTxs.length === 0 ? (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-xs text-center text-zinc-500 font-light">
                No high-risk transaction flags logged for this case scope.
              </div>
            ) : (
              <div className="overflow-hidden border border-[#E4E4E7] rounded-xl text-xs">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-[#FAF9F6] border-b border-[#E4E4E7] text-[10px] uppercase font-bold text-[#71717A] font-mono">
                      <th className="p-3 pl-4">Date</th>
                      <th className="p-3">Source Statement ID</th>
                      <th className="p-3">Sender / UPI ID</th>
                      <th className="p-3">Receiver / Account</th>
                      <th className="p-3">Narration</th>
                      <th className="p-3 text-right pr-4">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4E4E7] bg-white font-sans">
                    {suspiciousTxs.map((tx, idx) => {
                      const stmtId = String(tx?.statement_id || caseId || '');
                      return (
                        <tr key={tx?.id || idx} className="hover:bg-[#FAFAFA]">
                          <td className="p-3 pl-4 font-mono text-[#52525B]">{tx?.date || 'N/A'}</td>
                          <td className="p-3 font-mono text-[10px] text-[#71717A]">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate max-w-[100px]" title={stmtId}>{stmtId}</span>
                              {stmtId && (
                                <button
                                  onClick={() => copyToClipboard(stmtId)}
                                  className="text-[#2563EB] hover:text-blue-700 font-semibold cursor-pointer"
                                >
                                  {copiedId === stmtId ? 'Copied' : 'Copy'}
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="p-3 font-semibold text-[#18181B] max-w-[130px] truncate" title={tx?.sender_account || tx?.sender || 'N/A'}>
                            {tx?.upi_id || tx?.sender_account || tx?.sender || 'N/A'}
                          </td>
                          <td className="p-3 text-[#52525B] max-w-[130px] truncate" title={tx?.receiver_account || tx?.receiver || 'N/A'}>
                            {tx?.receiver_account || tx?.receiver || 'N/A'}
                          </td>
                          <td className="p-3 text-[#71717A] font-light max-w-sm truncate" title={tx?.narration || ''}>
                            {tx?.narration || 'Unspecified narration'}
                          </td>
                          <td className="p-3 text-right font-bold pr-4 text-[#18181B] font-mono">
                            {formatCurrency(tx?.amount || 0)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      )}

      {/* Email Report Modal */}
      {isEmailOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !isSendingEmail && setIsEmailOpen(false)} />
          <div className="relative bg-white border border-[#E4E4E7] rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 animate-fade-in">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE] flex items-center justify-center text-[#2563EB]">
                  <Mail className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#18181B] font-display">Email Investigation Report</h3>
                  <p className="text-[11px] text-[#71717A] font-light">
                    Scope: {caseId === 'all' ? 'Whole Network (all statements)' : `Statement ${safeSlice(caseId, 0, 8)}...`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => !isSendingEmail && setIsEmailOpen(false)}
                className="text-[#71717A] hover:text-[#18181B] p-1 rounded-md hover:bg-[#F4F4F5] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#52525B] uppercase font-mono block">Recipients</label>
                <input
                  type="text"
                  value={emailRecipients}
                  onChange={(e) => setEmailRecipients(e.target.value)}
                  placeholder="analyst@agency.gov, lead@agency.gov"
                  className="w-full bg-white border border-[#E4E4E7] focus:border-[#18181B] rounded-md px-3 py-2 text-xs text-[#18181B] focus:outline-none font-sans"
                />
                <p className="text-[9.5px] text-[#71717A] font-light">Separate multiple addresses with commas.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-[#52525B] uppercase font-mono block">Attachment Format</label>
                  <select
                    value={emailFormat}
                    onChange={(e) => setEmailFormat(e.target.value as 'pdf' | 'excel' | 'docx')}
                    className="w-full bg-white border border-[#E4E4E7] focus:border-[#18181B] rounded-md px-3 py-2 text-xs text-[#18181B] focus:outline-none cursor-pointer font-sans"
                  >
                    <option value="pdf">PDF Report</option>
                    <option value="excel">Excel Workbook</option>
                    <option value="docx">Word Document</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-[#52525B] uppercase font-mono block">Subject (optional)</label>
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder="Auto-generated if blank"
                    className="w-full bg-white border border-[#E4E4E7] focus:border-[#18181B] rounded-md px-3 py-2 text-xs text-[#18181B] focus:outline-none font-sans"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#52525B] uppercase font-mono block">Message (optional)</label>
                <textarea
                  value={emailMessage}
                  onChange={(e) => setEmailMessage(e.target.value)}
                  rows={3}
                  placeholder="Add a note for the recipients. A case summary is appended automatically."
                  className="w-full bg-white border border-[#E4E4E7] focus:border-[#18181B] rounded-md px-3 py-2 text-xs text-[#18181B] focus:outline-none font-sans resize-none"
                />
              </div>

              {emailResult && (
                <div className={`p-2.5 rounded-lg border text-[11px] font-semibold flex items-start gap-2 ${
                  emailResult.ok ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]' : 'bg-red-50 border-red-200 text-red-800'
                }`}>
                  {emailResult.ok ? <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />}
                  <span>{emailResult.msg}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                onClick={() => !isSendingEmail && setIsEmailOpen(false)}
                disabled={isSendingEmail}
                className="px-3.5 py-2 bg-white border border-[#E4E4E7] hover:border-[#18181B] text-[#52525B] text-xs font-semibold rounded-md cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSendEmail}
                disabled={isSendingEmail}
                className="px-4 py-2 bg-[#18181B] hover:bg-black text-white text-xs font-semibold rounded-md flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSendingEmail ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>{isSendingEmail ? 'Sending...' : 'Send Report'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
