import React, { useState, useEffect, useCallback } from 'react';
import { 
  ArrowRight, 
  CornerDownRight, 
  Coins, 
  ShieldAlert, 
  FileSearch, 
  Loader2, 
  AlertTriangle, 
  HelpCircle, 
  Search, 
  Check, 
  ChevronDown, 
  Calendar,
  User,
  Hash,
  Globe,
  Tag,
  Layers,
  MapPin
} from 'lucide-react';
import { useFinintelData } from '../context/FinintelDataContext';
import { getStatementTransactions, getMoneyTrail } from '../services/finintelApi';
import { AmountRangeFilter, AmountRange, EMPTY_RANGE, inAmountRange } from './AmountRangeFilter';
import { ServiceReportButtons } from './ServiceReportButtons';
import { channelOf, orderChannels } from '../services/channels';
import { BackendTransaction, MoneyTrailResponse } from '../types/api';

export default function MoneyTrailPage() {
  const { caseId, latestStatementId, statements } = useFinintelData();

  // Selected statement for credit source selection
  const [selectedStmtId, setSelectedStmtId] = useState<string>('');
  const [creditTxns, setCreditTxns] = useState<BackendTransaction[]>([]);
  const [selectedTxId, setSelectedTxId] = useState<string>('');
  
  // Custom dropdown open states
  const [isStmtDropdownOpen, setIsStmtDropdownOpen] = useState(false);
  const [isTxDropdownOpen, setIsTxDropdownOpen] = useState(false);
  const [txSearchQuery, setTxSearchQuery] = useState('');
  const [amountRange, setAmountRange] = useState<AmountRange>(EMPTY_RANGE);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [isChannelDropdownOpen, setIsChannelDropdownOpen] = useState(false);

  // Money Trail states
  const [trailData, setTrailData] = useState<MoneyTrailResponse['trail'] | null>(null);
  const [isLoadingTxns, setIsLoadingTxns] = useState(false);
  const [isLoadingTrail, setIsLoadingTrail] = useState(false);
  const [txnError, setTxnError] = useState<string | null>(null);
  const [trailError, setTrailError] = useState<string | null>(null);

  // Completed statements list
  const completedStatements = statements.filter(s => s.status === 'completed');

  // Align selectedStmtId based on global caseId and latestStatementId changes
  useEffect(() => {
    if (caseId && caseId !== 'all') {
      setSelectedStmtId(caseId);
    } else if (latestStatementId) {
      setSelectedStmtId(latestStatementId);
    } else if (completedStatements.length > 0) {
      setSelectedStmtId(completedStatements[0].id);
    }
  }, [caseId, latestStatementId, statements]);

  // Fetch transactions for the selected statement to list CREDITS
  const fetchTransactions = useCallback(async (stmtId: string) => {
    if (!stmtId) return;
    setIsLoadingTxns(true);
    setTxnError(null);
    setCreditTxns([]);
    setSelectedTxId('');
    setTrailData(null);
    try {
      const txs = await getStatementTransactions(stmtId, 1, 150);
      // Filter credit transactions
      const credits = txs.filter(t => t.debit_credit === 'CREDIT');
      setCreditTxns(credits);
      if (credits.length > 0) {
        setSelectedTxId(credits[0].id);
      }
    } catch (err: any) {
      console.error(err);
      setTxnError(err.message || "Failed to load statement transaction index.");
    } finally {
      setIsLoadingTxns(false);
    }
  }, []);

  // Fetch money trail for the selected transaction
  const fetchTrail = useCallback(async (txId: string) => {
    if (!txId) return;
    setIsLoadingTrail(true);
    setTrailError(null);
    try {
      const response = await getMoneyTrail(caseId, txId);
      if (response && response.trail) {
        setTrailData(response.trail);
      } else {
        setTrailData(null);
      }
    } catch (err: any) {
      console.error(err);
      setTrailError(err.message || "Failed to retrieve FIFO money trail.");
    } finally {
      setIsLoadingTrail(false);
    }
  }, [caseId]);

  useEffect(() => {
    if (selectedStmtId) {
      fetchTransactions(selectedStmtId);
    }
  }, [selectedStmtId, fetchTransactions]);

  useEffect(() => {
    if (selectedTxId) {
      fetchTrail(selectedTxId);
    }
  }, [selectedTxId, fetchTrail]);

  // When the channel / amount filter changes, snap the traced credit to the
  // first match so the trail below actually re-segregates to that category.
  useEffect(() => {
    if (creditTxns.length === 0) return;
    const matches = creditTxns.filter(
      (tx) =>
        inAmountRange(tx.amount, amountRange) &&
        (!selectedChannel || channelOf(tx) === selectedChannel)
    );
    if (matches.length > 0 && !matches.some((m) => m.id === selectedTxId)) {
      setSelectedTxId(matches[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChannel, amountRange.min, amountRange.max, creditTxns]);

  const activeTx = creditTxns.find(t => t.id === selectedTxId);

  // Channels present among the credit inflows, for the container dropdown.
  const availableChannels = orderChannels(creditTxns.map((tx) => channelOf(tx)));

  // Credits matching the search text, the amount-range and the channel filter.
  const filteredCredits = creditTxns.filter((tx) => {
    if (!inAmountRange(tx.amount, amountRange)) return false;
    if (selectedChannel && channelOf(tx) !== selectedChannel) return false;
    const q = txSearchQuery.toLowerCase();
    return (
      (tx.date?.toLowerCase().includes(q)) ||
      (tx.amount || 0).toString().includes(q) ||
      (tx.narration?.toLowerCase().includes(q))
    );
  });

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  const formatPercent = (val: number, total: number) => {
    if (!total) return '0%';
    return `${Math.round((val / total) * 100)}%`;
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8 animate-fade-in select-none">
      
      {/* Header Block */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E4E4E7] pb-6">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 text-xs text-[#2563EB] font-semibold bg-[#EFF6FF] border border-[#BFDBFE] px-2.5 py-0.5 rounded-full font-mono">
            <Coins className="w-3.5 h-3.5" />
            <span>FIFO Asset Tracing</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#18181B] font-display">Chronological Money Trails</h1>
          <p className="text-sm text-[#71717A] max-w-xl leading-relaxed font-sans font-light">
            First-In, First-Out (FIFO) tracing pairs chronological outflows back to suspicious source triggers, bypassing intermediate shell shields.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap self-start">
        {/* Per-service report export (scoped to the statement being traced) */}
        <ServiceReportButtons caseId={selectedStmtId || caseId} service="money-trail" />

        {/* Selective export: just the currently-selected credit's debit trail */}
        {selectedTxId && trailData && (
          <ServiceReportButtons
            caseId={selectedStmtId || caseId}
            service="money-trail"
            focus={selectedTxId}
            label="Export selected trail"
          />
        )}

        {/* Custom Statement Selector Dropdown */}
        {completedStatements.length > 0 && (
          <div className={`relative shrink-0 ${isStmtDropdownOpen ? 'z-50' : 'z-30'}`}>
            {isStmtDropdownOpen && (
              <div className="fixed inset-0 z-40" onClick={() => setIsStmtDropdownOpen(false)} />
            )}
            <button
              type="button"
              disabled={caseId !== 'all'}
              onClick={() => setIsStmtDropdownOpen(!isStmtDropdownOpen)}
              className="flex items-center justify-between gap-2.5 bg-white border border-[#E4E4E7] hover:border-zinc-400 rounded-lg p-2 px-3 text-xs font-semibold text-zinc-950 shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed min-w-[170px] relative transition-all"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase font-bold text-[#71717A] font-mono pr-2 border-r border-[#E4E4E7]">Statement</span>
                <span className="truncate max-w-[130px] font-medium text-zinc-900">
                  {completedStatements.find(s => s.id === selectedStmtId)?.filename || 'Select Statement'}
                </span>
              </div>
              <ChevronDown className="w-3 h-3 text-[#71717A] ml-1" />
            </button>
            
            {isStmtDropdownOpen && (
              <div className="absolute right-0 mt-1.5 w-64 bg-white border border-[#E4E4E7] rounded-xl shadow-lg z-50 py-1.5 max-h-60 overflow-y-auto animate-fade-in">
                {completedStatements.map(s => {
                  const isSelected = s.id === selectedStmtId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setSelectedStmtId(s.id);
                        setIsStmtDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3.5 py-2 text-xs transition-colors flex items-center justify-between hover:bg-[#FAF9F6] ${
                        isSelected ? 'bg-zinc-50 font-bold text-[#18181B]' : 'text-zinc-700 font-light'
                      }`}
                    >
                      <span className="truncate">{s.filename}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-zinc-800" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        </div>
      </div>

      {isLoadingTxns ? (
        <div className="h-64 border border-[#E4E4E7] bg-white rounded-xl flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-zinc-800" />
          <p className="text-xs text-[#71717A] font-light">Loading statement transaction indices...</p>
        </div>
      ) : txnError ? (
        <div className="border border-red-200 bg-red-50/50 rounded-xl p-8 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 text-red-500 mx-auto" />
          <h3 className="text-sm font-bold text-red-950">Failed to Retrieve Transactions</h3>
          <p className="text-xs text-red-700 font-light max-w-md mx-auto">{txnError}</p>
        </div>
      ) : creditTxns.length === 0 ? (
        <div className="border border-dashed border-[#E4E4E7] bg-white rounded-xl p-12 text-center space-y-3">
          <HelpCircle className="w-10 h-10 text-zinc-400 mx-auto" />
          <h3 className="text-sm font-bold text-[#18181B]">No Credit Sources Found</h3>
          <p className="text-xs text-[#71717A] font-light max-w-sm mx-auto">
            This statement does not contain any completed credit transactions to trace FIFO dispersion. Ingest a ledger containing credit deposits first.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          
          {/* Custom Searchable Credit Selection Bar */}
          <div className="bg-white border border-[#E4E4E7] rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
            <div className="space-y-1.5">
              <span className="text-[9px] uppercase tracking-wider font-bold text-[#71717A] font-mono block">Select Credit to Trace</span>
              <p className="text-xs text-[#71717A] font-light">Chronological FIFO disperses from this chosen ledger deposit.</p>
              <div className="flex items-center gap-2 flex-wrap">
                <AmountRangeFilter value={amountRange} onChange={setAmountRange} label="Credit ₹" />
                {availableChannels.length > 1 && (
                  <div className={`relative ${isChannelDropdownOpen ? 'z-50' : 'z-20'}`}>
                    {isChannelDropdownOpen && <div className="fixed inset-0 z-40" onClick={() => setIsChannelDropdownOpen(false)} />}
                    <button
                      type="button"
                      onClick={() => setIsChannelDropdownOpen(!isChannelDropdownOpen)}
                      className={`flex items-center gap-1.5 border rounded-lg px-2.5 py-1.5 text-xs font-semibold cursor-pointer relative transition-all ${
                        selectedChannel ? 'bg-blue-50 border-blue-300 text-blue-800' : 'bg-white border-[#E4E4E7] hover:border-zinc-400 text-zinc-950'
                      }`}
                    >
                      <span className="text-[10px] uppercase font-bold text-[#71717A] font-mono pr-1.5 border-r border-[#E4E4E7]">Channel</span>
                      <span className="font-medium">{selectedChannel || 'All'}</span>
                      <ChevronDown className="w-3 h-3 text-[#71717A]" />
                    </button>
                    {isChannelDropdownOpen && (
                      <div className="absolute left-0 mt-1 w-48 bg-white border border-[#E4E4E7] rounded-lg shadow-md z-50 py-1 max-h-56 overflow-y-auto animate-fade-in">
                        <button
                          type="button"
                          onClick={() => { setSelectedChannel(null); setIsChannelDropdownOpen(false); }}
                          className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between hover:bg-[#FAF9F6] ${!selectedChannel ? 'bg-zinc-50 font-bold text-[#18181B]' : 'text-zinc-700 font-light'}`}
                        >
                          <span>All Channels</span>
                          {!selectedChannel && <Check className="w-3.5 h-3.5 text-zinc-800" />}
                        </button>
                        {availableChannels.map((ch) => (
                          <button
                            key={ch}
                            type="button"
                            onClick={() => { setSelectedChannel(ch); setIsChannelDropdownOpen(false); }}
                            className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between hover:bg-[#FAF9F6] ${selectedChannel === ch ? 'bg-blue-50 font-bold text-blue-800' : 'text-zinc-700 font-light'}`}
                          >
                            <span>{ch}</span>
                            {selectedChannel === ch && <Check className="w-3.5 h-3.5 text-blue-700" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Custom Searchable Select combobox */}
            <div className={`relative w-full sm:w-120 ${isTxDropdownOpen ? 'z-50' : 'z-20'}`}>
              {isTxDropdownOpen && (
                <div className="fixed inset-0 z-40" onClick={() => {
                  setIsTxDropdownOpen(false);
                  setTxSearchQuery('');
                }} />
              )}
              <button
                type="button"
                onClick={() => setIsTxDropdownOpen(!isTxDropdownOpen)}
                className="w-full flex items-center justify-between gap-3 bg-[#FAF9F6] border border-[#E4E4E7] hover:border-[#18181B] rounded-lg px-3.5 py-2.5 text-xs font-semibold text-zinc-950 text-left shadow-sm cursor-pointer relative transition-all"
              >
                <span className="truncate flex-1 font-medium">
                  {activeTx 
                    ? `${activeTx.date ? `${activeTx.date} • ` : ''}${formatCurrency(activeTx.amount || 0)} - ${activeTx.narration?.slice(0, 45) || 'Generic Inflow'}`
                    : 'Select credit transaction to trace...'}
                </span>
                <ChevronDown className="w-4 h-4 text-[#71717A] shrink-0" />
              </button>
              
              {isTxDropdownOpen && (
                <div className="absolute left-0 right-0 mt-1.5 bg-white border border-[#E4E4E7] rounded-xl shadow-lg z-50 py-2 flex flex-col max-h-80 animate-fade-in">
                  
                  {/* Search input header */}
                  <div className="px-3 pb-2 border-b border-[#F4F4F5] flex items-center gap-2">
                    <Search className="w-3.5 h-3.5 text-[#71717A] shrink-0" />
                    <input
                      type="text"
                      placeholder="Search by narration or amount..."
                      value={txSearchQuery}
                      onChange={(e) => setTxSearchQuery(e.target.value)}
                      className="w-full bg-[#FAF9F6] border border-[#E4E4E7] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-zinc-400 font-sans"
                    />
                  </div>
                  
                  {/* Options list scroll container */}
                  <div className="overflow-y-auto max-h-56 py-1.5">
                    {filteredCredits
                      .map(tx => {
                        const isSelected = tx.id === selectedTxId;
                        return (
                          <button
                            key={tx.id}
                            type="button"
                            onClick={() => {
                              setSelectedTxId(tx.id);
                              setIsTxDropdownOpen(false);
                              setTxSearchQuery('');
                            }}
                            className={`w-full text-left px-3.5 py-2.5 hover:bg-[#FAF9F6] transition-colors flex items-start gap-2.5 border-b border-[#F4F4F5]/50 last:border-b-0 ${
                              isSelected ? 'bg-zinc-50 font-bold text-[#18181B]' : 'text-zinc-700 font-light'
                            }`}
                          >
                            <div className="flex-1 min-w-0 text-xs">
                              <div className="flex items-center justify-between w-full font-mono text-[10px]">
                                <span>{tx.date || 'N/A'}</span>
                                <span className="text-emerald-700 font-bold font-mono">+{formatCurrency(tx.amount || 0)}</span>
                              </div>
                              <p className="mt-1 font-sans text-zinc-900 break-words line-clamp-2">
                                {tx.narration || 'Generic Inflow'}
                              </p>
                            </div>
                            {isSelected && <Check className="w-4 h-4 text-zinc-800 shrink-0 self-center" />}
                          </button>
                        );
                      })}
                    {filteredCredits.length === 0 && (
                      <div className="text-center py-6 text-xs text-zinc-400 font-light">
                        No credits match your search / amount range.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {isLoadingTrail ? (
            <div className="h-[28rem] border border-[#E4E4E7] bg-white rounded-xl flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-zinc-800" />
              <p className="text-xs text-[#71717A] font-light">Resolving FIFO asset trails...</p>
            </div>
          ) : trailError ? (
            <div className="border border-red-200 bg-red-50/50 rounded-xl p-12 text-center space-y-3 h-[28rem] flex flex-col items-center justify-center">
              <AlertTriangle className="w-10 h-10 text-red-500 mx-auto" />
              <h3 className="text-sm font-bold text-red-950">Dispersion Calculation Failed</h3>
              <p className="text-xs text-red-700 font-light max-w-md mx-auto">{trailError}</p>
            </div>
          ) : !trailData ? (
            <div className="border border-dashed border-[#E4E4E7] bg-white rounded-xl p-12 text-center h-[28rem] flex flex-col items-center justify-center space-y-2">
              <FileSearch className="w-10 h-10 text-zinc-400 mx-auto" />
              <h3 className="text-sm font-bold text-[#18181B]">No Trail Path Compiled</h3>
              <p className="text-xs text-[#71717A] font-light">FIFO dispatch was not tracked for this transaction. Try choosing another credit item.</p>
            </div>
          ) : (
            
            /* Side-by-Side Dual Column Grid (Optimized heights, local scrollbars, no page scroll) */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              
              {/* Left Column: Visual Waterfall Diagram */}
              <div className="lg:col-span-7 bg-white border border-[#E4E4E7] rounded-xl p-6 flex flex-col space-y-4 shadow-xs">
                <div>
                  <h3 className="text-xs font-bold text-[#18181B] uppercase tracking-wider font-mono">
                    Chronological Asset Allocation Flow
                  </h3>
                  <p className="text-[11px] text-[#71717A] mt-1 font-light font-sans">
                    Flow visualization linking credit inflows directly to subsequent dispersion outflows.
                  </p>
                </div>

                {/* Waterfall Flex Container (Spans locally scrollable targets on the right) */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch bg-[#FAF9F6] p-4 rounded-xl border border-[#F4F4F5] flex-1">
                  
                  {/* Inflow Credit Trigger Source Card (Spans left) */}
                  <div className="md:col-span-5 border border-zinc-900 bg-zinc-900 text-white p-5 rounded-lg flex flex-col justify-between shadow-md relative min-h-[22rem]">
                    
                    {/* Top label / Title */}
                    <div className="space-y-1.5">
                      <span className="text-[9px] uppercase tracking-wider font-extrabold text-[#D4D4D8] font-mono block">
                        Inflow Credit Trigger
                      </span>
                      <h3 
                        className="text-xs font-extrabold leading-snug line-clamp-3 text-white font-sans" 
                        title={activeTx?.narration || 'Credit Inflow'}
                      >
                        {activeTx?.narration || 'Credit Inflow'}
                      </h3>
                    </div>
                    
                    {/* Middle: Amount */}
                    <div className="my-4">
                      <span className="text-[9px] text-[#A1A1AA] uppercase font-bold tracking-wider font-mono block">Received Amount</span>
                      <p className="text-2xl font-extrabold text-white mt-1 font-mono">
                        {formatCurrency(trailData.credit_amount ?? activeTx?.amount ?? 0)}
                      </p>
                    </div>

                    {/* Bottom: Transaction metadata fields */}
                    <div className="border-t border-white/10 pt-2.5 space-y-1.5 text-[9px] font-mono text-[#A1A1AA]">
                      <div className="flex justify-between gap-2">
                        <span>Settled Date:</span>
                        <span className="font-bold text-white truncate">{activeTx?.date || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span>Sender Acc:</span>
                        <span className="font-bold text-white truncate">{activeTx?.sender_account || 'N/A'}</span>
                      </div>
                      {activeTx?.reference_number && (
                        <div className="flex justify-between gap-2">
                          <span>Ref No:</span>
                          <span className="font-bold text-white truncate max-w-[100px]">{activeTx.reference_number}</span>
                        </div>
                      )}
                      {activeTx?.txn_type && (
                        <div className="flex justify-between gap-2">
                          <span>Tx Type:</span>
                          <span className="font-bold text-white truncate">{activeTx.txn_type}</span>
                        </div>
                      )}
                      {activeTx?.upi_id && (
                        <div className="flex justify-between gap-2">
                          <span>UPI ID:</span>
                          <span className="font-bold text-white truncate max-w-[90px]" title={activeTx.upi_id}>{activeTx.upi_id}</span>
                        </div>
                      )}
                      {activeTx?.bank_name && (
                        <div className="flex justify-between gap-2">
                          <span>Bank:</span>
                          <span className="font-bold text-white truncate">{activeTx.bank_name}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Mid Arrow indicator */}
                  <div className="hidden md:flex md:col-span-1 items-center justify-center text-[#A1A1AA]">
                    <ArrowRight className="w-5 h-5 stroke-[1.5px]" />
                  </div>

                  {/* Right: Dispersion targets list (Locally scrollable, fixed height) */}
                  <div className="md:col-span-6 overflow-y-auto max-h-[26rem] pr-1 space-y-2">
                    {(!trailData.consumed_by || trailData.consumed_by.length === 0) ? (
                      <div className="bg-white border border-[#E4E4E7] rounded-lg p-6 text-center text-xs text-zinc-500 font-light flex items-center justify-center h-full">
                        No chronologically subsequent debits consumed this credit volume. Remaining balance sits in account.
                      </div>
                    ) : (
                      trailData.consumed_by.map((node, idx) => {
                        const amt = node.amount || 0;
                        const srcAmt = trailData.credit_amount || activeTx?.amount || 1;
                        
                        return (
                          <div 
                            key={idx}
                            className="bg-white border border-[#E4E4E7] rounded-lg p-3 flex flex-col justify-between gap-2 text-xs transition-shadow hover:shadow-xs"
                          >
                            <div className="space-y-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[8px] uppercase tracking-wider font-extrabold text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded leading-none font-mono">
                                  Dispersion #{idx + 1}
                                </span>
                                <span className="text-[9px] text-[#71717A] font-mono font-medium">
                                  Ratio: {formatPercent(amt, srcAmt)}
                                </span>
                              </div>
                              <h4 className="font-bold text-[#18181B] truncate font-sans" title={node.destination || node.narration || ''}>
                                {node.destination || node.narration || 'Unspecified Account'}
                              </h4>
                              {node.narration && (
                                <p className="text-[9.5px] text-[#52525B] line-clamp-2 font-light font-sans" title={node.narration}>
                                  {node.narration}
                                </p>
                              )}
                              {node.location && (
                                <p className="text-[9px] text-[#DC2626] font-bold font-mono flex items-center gap-1">
                                  <MapPin className="w-2.5 h-2.5 shrink-0" /> {node.location.city}, {node.location.state}
                                </p>
                              )}
                              <p className="text-[9px] text-[#71717A] truncate font-light font-mono">
                                Date: {node.date || 'N/A'} • TX ID: {node.debit_txn_id?.slice(0, 10)}...
                              </p>
                            </div>

                            <div className="border-t border-[#F4F4F5] pt-1.5 flex items-center justify-between">
                              <span className="text-[9px] text-[#C2410C] font-bold uppercase font-mono tracking-wider">Traced Outflow</span>
                              <strong className="font-bold text-zinc-950 font-mono">{formatCurrency(amt)}</strong>
                            </div>
                            {node.untraced != null && node.untraced > 0.01 && (
                              <div className="flex items-center justify-between text-[9px] font-mono">
                                <span className="text-[#71717A]">Of ₹{(node.debit_total || 0).toLocaleString('en-IN')} debit</span>
                                <span className="font-bold text-amber-700">{formatCurrency(node.untraced)} untracked</span>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>

                </div>
              </div>

              {/* Right Column: Chronological FIFO Dispatch Log */}
              <div className="lg:col-span-5 bg-white border border-[#E4E4E7] rounded-xl p-6 flex flex-col space-y-4 shadow-xs">
                <div>
                  <h3 className="text-xs font-bold text-[#18181B] uppercase tracking-wider font-mono">
                    Chronological FIFO Dispatch Log
                  </h3>
                  <p className="text-[11px] text-[#71717A] mt-1 font-light font-sans">
                    Detailed dispersion allocations based on first-in first-out account ledger balancing. Fully Traced: <strong className="font-bold text-zinc-950">{trailData.fully_traced ? 'YES' : 'NO'}</strong>.
                  </p>
                </div>

                {/* Dispatch Balance Summary banner */}
                <div className="bg-[#FAF9F6] border border-[#E4E4E7] rounded-xl p-3 space-y-2 text-[10px] font-mono text-[#52525B]">
                  <div className="flex justify-between">
                    <span>Credit Received:</span>
                    <span className="font-bold text-zinc-900">{formatCurrency(trailData.credit_amount || 0)}</span>
                  </div>
                  <div className="flex justify-between border-t border-[#E4E4E7] pt-1">
                    <span>Spent Outflows:</span>
                    <span className="font-bold text-zinc-900">{formatCurrency(trailData.spent || 0)}</span>
                  </div>
                  <div className="flex justify-between border-t border-[#E4E4E7] pt-1">
                    <span>Remaining Balance:</span>
                    <span className={`font-bold ${trailData.remaining && trailData.remaining > 0 ? 'text-emerald-700' : 'text-zinc-900'}`}>
                      {formatCurrency(trailData.remaining || 0)}
                    </span>
                  </div>
                </div>

                {/* Dispatch Log Steps (Locally scrollable, fixed height) */}
                <div className="flex-1 overflow-y-auto max-h-[22rem] pr-1 divide-y divide-[#F4F4F5] text-xs">
                  {trailData.consumed_by && trailData.consumed_by.map((node, index) => {
                    const amt = node.amount || 0;
                    const srcAmt = trailData.credit_amount || activeTx?.amount || 1;
                    return (
                      <div key={index} className="py-3 flex items-start gap-2.5 first:pt-0 last:pb-0 font-sans">
                        <CornerDownRight className="w-3.5 h-3.5 text-[#71717A] shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-baseline gap-2">
                            <span className="font-bold text-[#18181B] truncate" title={node.destination || node.narration || ''}>
                              {node.destination || node.narration || 'Unspecified Account'}
                            </span>
                            <span className="font-extrabold text-[#C2410C] font-mono shrink-0">{formatCurrency(amt)}</span>
                          </div>
                          {node.narration && (
                            <p className="text-[10px] text-[#52525B] mt-1 font-light leading-relaxed line-clamp-2" title={node.narration}>
                              {node.narration}
                            </p>
                          )}
                          {node.location && (
                            <p className="text-[10px] text-[#DC2626] mt-1 font-bold font-mono flex items-center gap-1">
                              <MapPin className="w-3 h-3 shrink-0" /> Cash-out: {node.location.city}, {node.location.state}
                            </p>
                          )}
                          <p className="text-[10px] text-[#71717A] mt-1 font-light leading-relaxed">
                            Chronologically charged against credit trigger volume at proportion ratio of <strong className="font-bold text-zinc-800 font-mono">{formatPercent(amt, srcAmt)}</strong>.
                          </p>
                          {node.untraced != null && node.untraced > 0.01 ? (
                            <p className="text-[10px] mt-1 font-mono bg-amber-50 border border-amber-200 rounded px-1.5 py-1 text-amber-800">
                              This debit was <strong>{formatCurrency(node.debit_total || 0)}</strong> — {formatCurrency(amt)} traced to this credit; <strong>{formatCurrency(node.untraced)} spent from untracked funds</strong>.
                            </p>
                          ) : (node.debit_total != null && node.debit_total > amt + 0.01 && (
                            <p className="text-[10px] mt-1 font-mono text-[#71717A]">
                              Part of a <strong className="text-zinc-800">{formatCurrency(node.debit_total)}</strong> debit split across multiple credits ({formatCurrency(amt)} from this credit).
                            </p>
                          ))}
                          <p className="text-[8.5px] text-[#A1A1AA] mt-0.5 font-mono truncate" title={node.debit_txn_id}>
                            Tx ID: {node.debit_txn_id}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  {(!trailData.consumed_by || trailData.consumed_by.length === 0) && (
                    <p className="text-[11px] text-[#71717A] font-light text-center py-12">
                      No dispatch log events mapped.
                    </p>
                  )}
                </div>
              </div>

            </div>
          )}

        </div>
      )}

    </div>
  );
}
