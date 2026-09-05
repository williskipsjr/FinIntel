import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ArrowRight, ShieldAlert, CheckCircle, Clock, AlertTriangle, Loader2, ChevronDown, Check } from 'lucide-react';
import { useFinintelData } from '../context/FinintelDataContext';
import { getRoundTrips, getRoundTripExplanation } from '../services/finintelApi';
import { RiskBadges } from './RiskBadge';
import { AmountRangeFilter, AmountRange, EMPTY_RANGE, inAmountRange } from './AmountRangeFilter';
import { ServiceReportButtons } from './ServiceReportButtons';
import { RoundTrip } from '../types/api';

const getAdjustedPoints = (p1: { x: number; y: number }, p2: { x: number; y: number }, offset = 35) => {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { start: p1, end: p2 };
  return {
    start: {
      x: p1.x + (dx * offset) / len,
      y: p1.y + (dy * offset) / len,
    },
    end: {
      x: p2.x - (dx * offset) / len,
      y: p2.y - (dy * offset) / len,
    }
  };
};

export default function RoundTripsPage({ onNavigateToView }: { onNavigateToView?: (view: string) => void }) {
  const { caseId, setCaseId, latestStatementId } = useFinintelData();

  const [roundTrips, setRoundTrips] = useState<RoundTrip[]>([]);
  const [activeTab, setActiveTab] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Explanation states (narrative + why indicators)
  const [explanation, setExplanation] = useState<{ narrative: string; why: string[] } | null>(null);
  const [isLoadingExplanation, setIsLoadingExplanation] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isScopeDropdownOpen, setIsScopeDropdownOpen] = useState(false);
  const [amountRange, setAmountRange] = useState<AmountRange>(EMPTY_RANGE);

  const fetchTrips = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setExplanation(null);
    try {
      const response = await getRoundTrips(caseId);
      const trips = response.round_trips || [];
      setRoundTrips(trips);
      setActiveTab(0);
      
      if (trips.length > 0) {
        fetchExplanation(0, trips[0]);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load round trips from gateway.");
    } finally {
      setIsLoading(false);
    }
  }, [caseId]);

  const fetchExplanation = async (index: number, trip: RoundTrip) => {
    const chainId = trip.id !== undefined ? trip.id : index;
    setIsLoadingExplanation(true);
    setExplanation(null);
    try {
      const response = await getRoundTripExplanation(caseId, chainId);
      if (response && (response.narrative || response.why)) {
        setExplanation({
          narrative: response.narrative || '',
          why: response.why || [],
        });
      } else {
        const fallbackText = (response as any).explanation || (response as any).why_flagged || (response as any).details || '';
        setExplanation({
          narrative: fallbackText,
          why: []
        });
      }
    } catch (err) {
      console.error("Failed to fetch explanation for round-trip:", err);
      // Fallback description based on nodes and amounts
      const nodes = trip.accounts || trip.nodes || [];
      const fallbackNarrative = `Circular chain detected with ${nodes.length} hops. Total value of ${
        formatCurrency(trip.total_amount ?? trip.totalAmount ?? 0)
      } circulated back to origin in ${trip.duration || 'unknown duration'}.`;
      setExplanation({
        narrative: fallbackNarrative,
        why: [
          "Circular loop detected in transaction logs.",
          "High transaction velocity between accounts forming a cycle."
        ]
      });
    } finally {
      setIsLoadingExplanation(false);
    }
  };

  useEffect(() => {
    fetchTrips();
  }, [fetchTrips]);

  // When the amount filter changes, snap the selection back to the first match.
  useEffect(() => {
    setActiveTab(0);
    setExplanation(null);
  }, [amountRange.min, amountRange.max]);

  const handleTabSelect = (idx: number, trip: RoundTrip) => {
    setActiveTab(idx);
    fetchExplanation(idx, trip);
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  // Compact ₹ for tight edge labels (₹1.25Cr / ₹3.40L), full amount kept for tooltips.
  const formatCompact = (val: number) => {
    const n = Number(val) || 0;
    if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
    if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
    return formatCurrency(n);
  };

  // Amount-range filter on circulated volume (total, falling back to bottleneck).
  const filteredTrips = roundTrips.filter((t) =>
    inAmountRange(t.total_amount ?? t.totalAmount ?? t.min_amount ?? 0, amountRange)
  );

  const currentTrip = filteredTrips[activeTab];
  const currentFlow = currentTrip ? (currentTrip.accounts || currentTrip.nodes || []) : [];

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8 animate-fade-in select-none">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E4E4E7] pb-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 text-xs text-[#DC2626] font-semibold bg-[#FEF2F2] border border-[#FCA5A5] px-2.5 py-0.5 rounded-full font-mono">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Circular Loops Detected</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#18181B] font-display">Suspicious Round Trips</h1>
          <p className="text-sm text-[#71717A] max-w-xl leading-relaxed font-sans font-light">
            Circular capital flows designed to disguise sovereign dividends, artificial valuations, or tax jurisdiction swaps.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap self-start">
        {/* Per-service report export */}
        <ServiceReportButtons caseId={caseId} service="round-trips" />

        {/* Selective export: just the currently-selected round-trip chain */}
        {currentTrip && currentTrip.id !== undefined && (
          <ServiceReportButtons
            caseId={caseId}
            service="round-trips"
            focus={currentTrip.id}
            label="Export selected chain"
          />
        )}

        {/* Amount range filter */}
        <AmountRangeFilter value={amountRange} onChange={setAmountRange} />

        {/* Custom Case Scope Dropdown */}
        <div className={`relative shrink-0 ${isScopeDropdownOpen ? 'z-50' : 'z-30'}`}>
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
                  : `Current Statement (${caseId.slice(0, 8)}...)`}
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
                  <span>Current Statement ({latestStatementId.slice(0, 8)}...)</span>
                  {caseId === latestStatementId && <Check className="w-3.5 h-3.5 text-zinc-800" />}
                </button>
              )}
            </div>
          )}
        </div>
        </div>
      </div>

      {isLoading ? (
        <div className="h-64 border border-[#E4E4E7] bg-white rounded-xl flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-zinc-800" />
          <p className="text-xs text-[#71717A] font-light">Scanning ledger graphs for cycles...</p>
        </div>
      ) : error ? (
        <div className="border border-red-200 bg-red-50/50 rounded-xl p-8 text-center space-y-4">
          <AlertTriangle className="w-10 h-10 text-red-500 mx-auto" />
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-red-950">Forensics Retrieval Error</h3>
            <p className="text-xs text-red-700 font-light max-w-md mx-auto">{error}</p>
          </div>
          <button
            onClick={fetchTrips}
            className="px-4 py-1.5 bg-red-900 text-white text-xs font-semibold rounded-lg hover:bg-red-950 transition-colors"
          >
            Retry Diagnostics Scan
          </button>
        </div>
      ) : roundTrips.length === 0 ? (
        <div className="border border-dashed border-[#E4E4E7] bg-white rounded-xl p-12 text-center space-y-3">
          <CheckCircle className="w-10 h-10 text-emerald-600 mx-auto" />
          <div>
            <h3 className="text-sm font-bold text-[#18181B]">No Cycles Identified</h3>
            <p className="text-xs text-[#71717A] font-light max-w-sm mx-auto mt-1 leading-relaxed">
              Forensic scanning complete. No closed loop transfer paths found matching asset-inflation patterns within this case scope.
            </p>
          </div>
        </div>
      ) : (
        /* Primary Grid Workspace */
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
          
          {/* Left Side: Loop Selectors */}
          <div className="md:col-span-4 space-y-3">
            <span className="text-[10px] font-bold text-[#71717A] uppercase tracking-wider block font-mono">
              Cycle Directory ({filteredTrips.length}{filteredTrips.length !== roundTrips.length ? ` of ${roundTrips.length}` : ''})
            </span>

            {filteredTrips.length === 0 ? (
              <p className="text-[11px] text-[#71717A] font-light py-6 text-center border border-dashed border-[#E4E4E7] rounded-lg">
                No round trips in this amount range.
              </p>
            ) : (
            <div className="space-y-2.5 max-h-[38rem] overflow-y-auto pr-1">
              {filteredTrips.map((trip, idx) => {
                const isSelected = activeTab === idx;
                const tripId = trip.id !== undefined ? `Round Trip #${trip.id}` : `Round Trip #${idx + 1}`;
                const amountVal = trip.total_amount ?? trip.totalAmount ?? trip.min_amount ?? 0;
                const flowList = trip.accounts || trip.nodes || [];

                return (
                  <button
                    key={idx}
                    onClick={() => handleTabSelect(idx, trip)}
                    className={`w-full text-left p-4 rounded-xl border transition-all text-xs flex flex-col justify-between cursor-pointer ${
                      isSelected 
                        ? 'bg-white border-[#18181B] shadow-[0_4px_12px_rgba(0,0,0,0.03)] ring-1 ring-zinc-950' 
                        : 'bg-[#FAF9F6] border-[#E4E4E7] hover:border-[#18181B]'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                       <span className="font-bold text-[#18181B] font-sans">{tripId}</span>
                       <span className="text-[10px] text-[#71717A] font-medium bg-white px-2 py-0.5 rounded border border-[#E4E4E7] font-mono">
                         {trip.duration || `${trip.hops || flowList.length} hops`}
                       </span>
                    </div>
                    
                    <div className="mt-2.5">
                      <p className="font-semibold text-slate-700 text-[11px] font-sans">
                        Circular Volume Flow
                      </p>
                      <p className="text-lg font-bold text-[#18181B] mt-1 font-mono">{formatCurrency(amountVal)}</p>
                    </div>

                    <div className="mt-3 flex items-center gap-1.5 text-[9px] text-[#71717A] max-w-full truncate overflow-hidden bg-white p-1.5 rounded border border-[#E4E4E7] font-mono">
                      {flowList.map((node, nIdx) => (
                        <React.Fragment key={nIdx}>
                          <span className="truncate max-w-[65px] font-medium">{node}</span>
                          {nIdx < flowList.length - 1 && <span>→</span>}
                        </React.Fragment>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
            )}
          </div>

          {/* Right Side: Visual Graph & Details */}
          <div className="md:col-span-8 space-y-6">
            
            {/* Graph Visualization Card */}
            <div className="bg-white border border-[#E4E4E7] rounded-xl p-6 space-y-4">
              {/* Dynamic flow styling */}
              <style>{`
                @keyframes flowingPath {
                  from { stroke-dashoffset: 24; }
                  to { stroke-dashoffset: 0; }
                }
                .flow-line {
                  stroke-dasharray: 6, 8;
                  animation: flowingPath 1.2s linear infinite;
                }
              `}</style>
              
              <span className="text-[10px] font-bold text-[#71717A] uppercase tracking-wider block font-mono">
                Loop Graph Visualization
              </span>

              {/* Responsive SVG Flowchart */}
              <div className="h-64 border border-[#F4F4F5] bg-[#FAF9F6] rounded-lg flex items-center justify-center p-4 relative overflow-hidden">
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 240">
                  <defs>
                    <marker
                      id="arrow"
                      viewBox="0 0 10 10"
                      refX="6"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#DC2626" />
                    </marker>
                    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#FF8A8A" />
                      <stop offset="100%" stopColor="#DC2626" />
                    </radialGradient>
                  </defs>

                  {(() => {
                    const N = currentFlow.length;
                    const cx = 200;
                    const cy = 120;
                    const rx = 120;
                    const ry = 65;

                    // Generate points for the nodes
                    const points = currentFlow.map((_, i) => {
                      const angle = (2 * Math.PI * i) / N - Math.PI / 2;
                      return {
                        x: cx + rx * Math.cos(angle),
                        y: cy + ry * Math.sin(angle),
                      };
                    });

                    // Build list of edges (curved paths)
                    const edges: { d: string; key: string }[] = [];
                    if (N === 2) {
                      // Beautiful cubic bezier curves sweeping wide outside the nodes
                      edges.push({
                        d: "M 245 55 C 370 55, 370 185, 245 185",
                        key: "edge-0"
                      });
                      edges.push({
                        d: "M 155 185 C 30 185, 30 55, 155 55",
                        key: "edge-1"
                      });
                    } else if (N > 0) {
                      // Clockwise curves for N > 2
                      for (let i = 0; i < N; i++) {
                        const p1 = points[i];
                        const p2 = points[(i + 1) % N];
                        const adj = getAdjustedPoints(p1, p2, 35);
                        const dx = adj.end.x - adj.start.x;
                        const dy = adj.end.y - adj.start.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        const r = dist * 1.3;
                        edges.push({
                          d: `M ${adj.start.x} ${adj.start.y} A ${r} ${r} 0 0 1 ${adj.end.x} ${adj.end.y}`,
                          key: `edge-${i}`
                        });
                      }
                    }

                    // Edge amount labels (₹) positioned at each hop's midpoint.
                    // edge_amounts[i] is the transfer from node[i] -> node[(i+1)%N].
                    const edgeAmounts: number[] = Array.isArray(currentTrip.edge_amounts)
                      ? currentTrip.edge_amounts
                      : [];
                    const edgeLabels: { x: number; y: number; text: string; full: string; from: string; to: string }[] = [];
                    if (N === 2) {
                      const spots = [{ x: 330, y: 124 }, { x: 70, y: 124 }];
                      for (let i = 0; i < 2; i++) {
                        const amt = edgeAmounts[i];
                        if (amt == null) continue;
                        edgeLabels.push({
                          x: spots[i].x, y: spots[i].y,
                          text: formatCompact(amt), full: formatCurrency(amt),
                          from: currentFlow[i % N], to: currentFlow[(i + 1) % N],
                        });
                      }
                    } else if (N > 2) {
                      for (let i = 0; i < N; i++) {
                        const amt = edgeAmounts[i];
                        if (amt == null) continue;
                        const p1 = points[i];
                        const p2 = points[(i + 1) % N];
                        const mx = (p1.x + p2.x) / 2;
                        const my = (p1.y + p2.y) / 2;
                        const dx = mx - cx;
                        const dy = my - cy;
                        const len = Math.sqrt(dx * dx + dy * dy) || 1;
                        edgeLabels.push({
                          x: mx + (dx / len) * 16,
                          y: my + (dy / len) * 16,
                          text: formatCompact(amt), full: formatCurrency(amt),
                          from: currentFlow[i], to: currentFlow[(i + 1) % N],
                        });
                      }
                    }

                    return (
                      <>
                        {/* Background tracks */}
                        {edges.map((edge) => (
                          <path 
                            key={`bg-${edge.key}`}
                            d={edge.d} 
                            fill="none" 
                            stroke="#E4E4E7" 
                            strokeWidth="2.5" 
                            strokeLinecap="round"
                          />
                        ))}

                        {/* Animated active flow dash lines */}
                        {edges.map((edge) => (
                          <path 
                            key={`active-${edge.key}`}
                            d={edge.d} 
                            fill="none" 
                            stroke="#DC2626" 
                            strokeWidth="2.5" 
                            strokeDasharray="6 6"
                            markerEnd="url(#arrow)"
                            className="flow-line"
                          />
                        ))}

                        {/* Glowing sliding energy pulses */}
                        {edges.map((edge) => (
                          <circle 
                            key={`pulse-${edge.key}`}
                            r="5" 
                            fill="url(#glow)"
                          >
                            <animateMotion dur="2.4s" repeatCount="indefinite" path={edge.d} />
                          </circle>
                        ))}

                        {/* Draw nodes */}
                        {points.map((pt, i) => {
                          const label = currentFlow[i];
                          const isOrigin = i === N - 1 || i === 0;
                          return (
                            <g key={i} transform={`translate(${pt.x}, ${pt.y})`}>
                              <rect 
                                x="-45" 
                                y="-12" 
                                width="90" 
                                height="24" 
                                rx="4" 
                                fill={isOrigin ? "#18181B" : "#FFFFFF"} 
                                stroke={isOrigin ? "#18181B" : "#E4E4E7"} 
                                strokeWidth="1.5" 
                                className="shadow-xs"
                              />
                              <text 
                                y="3" 
                                textAnchor="middle" 
                                fill={isOrigin ? "#FFFFFF" : "#18181B"} 
                                fontSize="8" 
                                fontWeight={isOrigin ? "bold" : "semibold"}
                                className="font-sans"
                              >
                                {label.length > 15 ? `${label.slice(0, 12)}...` : label}
                              </text>
                            </g>
                          );
                        })}

                        {/* Middle status indicator text */}
                        <text x="200" y="112" textAnchor="middle" fill="#71717A" fontSize="7" fontWeight="bold" className="font-mono tracking-wider">
                          CLOSED CONVERSION
                        </text>
                        <text x="200" y="128" textAnchor="middle" fill="#18181B" fontSize="12" fontWeight="extrabold" className="font-mono">
                          {formatCurrency(currentTrip.total_amount ?? currentTrip.totalAmount ?? currentTrip.min_amount ?? 0)}
                        </text>

                        {/* Per-edge transfer amounts (dark pill so they read on any edge) */}
                        {edgeLabels.map((lbl, i) => {
                          const w = Math.max(30, lbl.text.length * 5.4 + 10);
                          return (
                            <g key={`amt-${i}`} style={{ pointerEvents: 'auto' }}>
                              <title>{`${lbl.from} → ${lbl.to}: ${lbl.full}`}</title>
                              <rect
                                x={lbl.x - w / 2}
                                y={lbl.y - 8}
                                width={w}
                                height={15}
                                rx={7.5}
                                fill="#18181B"
                                opacity="0.92"
                                stroke="#3F3F46"
                                strokeWidth="0.5"
                              />
                              <text
                                x={lbl.x}
                                y={lbl.y + 2.6}
                                textAnchor="middle"
                                fill="#E0F2FE"
                                fontSize="8"
                                fontWeight="bold"
                                className="font-mono"
                              >
                                {lbl.text}
                              </text>
                            </g>
                          );
                        })}
                      </>
                    );
                  })()}
                </svg>
              </div>
            </div>

            {/* Diagnosis Info */}
            <div className="bg-white border border-[#E4E4E7] rounded-xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#F4F4F5] pb-3">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-[#E11D48] bg-[#FFF1F2] border border-[#FFE4E6] px-2 py-0.5 rounded font-semibold uppercase tracking-wider font-mono">
                      Reason Flagged
                    </span>
                    <RiskBadges tags={[{ key: 'CIRCULAR', label: 'Circular Money Flow' }]} size="xs" />
                  </div>
                  <h3 className="text-xs font-bold text-[#18181B] mt-2 font-sans">Analytical Ledger Disclosures</h3>
                </div>
                
                {(() => {
                  // Extract statement ID from the current loop nodes
                  const nodesList = currentFlow;
                  let stmtId: string | null = null;
                  for (const node of nodesList) {
                    if (node.startsWith("STMT:")) {
                      stmtId = node.replace("STMT:", "");
                      break;
                    }
                  }
                  if (!stmtId) return null;
                  return (
                    <div className="flex items-center gap-1.5 bg-[#FAF9F6] border border-[#E4E4E7] px-2 py-1 rounded-md text-[10px] text-[#52525B] font-mono shrink-0">
                      <span>Statement ID:</span>
                      <span className="font-bold select-all truncate max-w-[120px]">{stmtId}</span>
                      <button
                        onClick={() => {
                          if (stmtId) {
                            navigator.clipboard.writeText(stmtId);
                            setCopiedId(stmtId);
                            setTimeout(() => setCopiedId(null), 2000);
                          }
                        }}
                        className={`font-sans font-bold cursor-pointer hover:underline pl-1 border-l border-[#E4E4E7] ${
                          copiedId === stmtId ? 'text-green-600 hover:text-green-700' : 'text-[#2563EB] hover:text-blue-700'
                        }`}
                      >
                        {copiedId === stmtId ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  );
                })()}
              </div>
              
              {isLoadingExplanation ? (
                <div className="flex items-center gap-2 py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-[#71717A]" />
                  <span className="text-xs text-[#71717A] font-light">Retrieving explanation context...</span>
                </div>
              ) : (
                <div className="space-y-4">
                  {explanation?.narrative && (
                    <div className="space-y-1">
                      <span className="text-[9px] font-bold text-[#71717A] uppercase font-mono block">Narrative Brief</span>
                      <p className="text-xs text-[#52525B] leading-relaxed font-light font-sans bg-[#FAF9F6] p-3 rounded-lg border border-[#E4E4E7]">
                        {explanation.narrative}
                      </p>
                    </div>
                  )}
                  {explanation?.why && explanation.why.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-[9px] font-bold text-[#71717A] uppercase font-mono block">Diagnostic Indicators</span>
                      <ul className="space-y-1.5">
                        {explanation.why.map((item, index) => (
                          <li key={index} className="text-xs text-[#52525B] font-sans flex items-start gap-2">
                            <span className="text-[#DC2626] font-bold mt-0.5">•</span>
                            <span className="font-light leading-relaxed">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {!explanation?.narrative && !explanation?.why && (
                    <p className="text-xs text-[#52525B] leading-relaxed font-light font-sans bg-[#FAF9F6] p-3 rounded-lg border border-[#E4E4E7]">
                      No explanation context available.
                    </p>
                  )}
                </div>
              )}
            </div>

          </div>

        </div>
      )}

    </div>
  );
}
