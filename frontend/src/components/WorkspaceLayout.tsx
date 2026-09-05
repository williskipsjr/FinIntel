import React, { useEffect, useState, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Shield, Layers, LogOut, Bell, X, Check } from "lucide-react";
import { isAuthenticated, getSession, logout, initials } from "../services/auth";
import { getAlerts, getAlertCount, acknowledgeAlert, Alert } from "../services/finintelApi";
import { useFinintelData } from "../context/FinintelDataContext";
import { RiskBadge } from "./RiskBadge";

export default function WorkspaceLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setCaseId } = useFinintelData();

  // Route auth guard: redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated()) {
      navigate("/login");
    }
  }, [navigate]);

  const session = getSession();
  const displayName = session?.name || "Investigator";
  const displayDivision = session?.division || "AML Division";
  const displayInitials = initials(displayName);

  const handleSignOut = () => {
    logout();
    navigate("/login");
  };

  // ---- Alerts (nav bell + panel) ----
  const [alertCount, setAlertCount] = useState(0);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);

  const refreshAlertCount = useCallback(async () => {
    try {
      const res = await getAlertCount();
      setAlertCount(res?.unacknowledged ?? 0);
    } catch { /* backend may be offline */ }
  }, []);

  // Poll the unread count (fresh after a statement finishes processing).
  useEffect(() => {
    refreshAlertCount();
    const t = setInterval(refreshAlertCount, 20000);
    return () => clearInterval(t);
  }, [refreshAlertCount, location.pathname]);

  const openAlerts = async () => {
    setIsAlertsOpen((o) => !o);
    if (!isAlertsOpen) {
      try {
        setAlerts(await getAlerts(true, 100));
      } catch { setAlerts([]); }
    }
  };

  const handleAck = async (id: string) => {
    try {
      await acknowledgeAlert(id);
      setAlerts((a) => a.filter((x) => x.id !== id));
      setAlertCount((c) => Math.max(0, c - 1));
    } catch { /* noop */ }
  };

  const goToAlert = (alert: Alert) => {
    setIsAlertsOpen(false);
    if (alert.statement_id) setCaseId(alert.statement_id);
    const view = alert.category === 'CIRCULAR' ? 'round-trips'
      : alert.category === 'RAPID_PASSTHROUGH' ? 'money-flow'
      : 'reports';
    navigate(`/workspace/${view}`);
  };

  const navItems = [
    { id: 'overview', label: 'Overview', path: '/workspace' },
    { id: 'round-trips', label: 'Round Trips', path: '/workspace/round-trips' },
    { id: 'money-flow', label: 'Money Flow', path: '/workspace/money-flow' },
    { id: 'money-trails', label: 'Money Trails', path: '/workspace/money-trails' },
    { id: 'reports', label: 'Reports', path: '/workspace/reports' },
    { id: 'settings', label: 'Settings', path: '/workspace/settings' }
  ];

  const getIsActive = (path: string) => {
    if (path === '/workspace') {
      return location.pathname === '/workspace';
    }
    return location.pathname.startsWith(path);
  };

  return (
    <div className="workspace-root min-h-screen bg-[#FAFAFA] flex flex-col font-sans select-none antialiased text-[#18181B]">
      
      {/* Pristine Modern Top Header Navigation Bar (Stripe/Vercel Aesthetic) */}
      <nav className="h-14 bg-white border-b border-[#E4E4E7] px-6 flex items-center justify-between gap-3 sticky top-0 z-50 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">

        {/* Brand identity */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 bg-zinc-950 rounded-md flex items-center justify-center text-[#FAFAFA] shrink-0 shadow-xs border border-zinc-800">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <div className="flex flex-col select-none">
            <span className="font-bold text-[13px] tracking-tight text-zinc-950 leading-none">FinIntel OS</span>
            <span className="text-[7.5px] font-mono font-medium uppercase tracking-[0.16em] text-zinc-500 mt-1 leading-none">Platform Level 4</span>
          </div>
        </div>

        {/* Clean horizontal nav links — ALWAYS visible on top (every width /
            zoom / display-scale). The strip scrolls horizontally instead of
            being clipped or dropping off the header when space is tight, so the
            service tabs never disappear. */}
        <div className="flex items-center gap-1 min-w-0 overflow-x-auto no-scrollbar">
          {navItems.map((item) => {
            const isActive = getIsActive(item.path);
            return (
              <button
                key={item.id}
                onClick={() => navigate(item.path)}
                className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-[#18181B] text-white font-semibold'
                    : 'text-[#52525B] hover:text-[#18181B] hover:bg-[#F4F4F5]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* User Identity Pill & Security Badge / Sign Out */}
        <div className="flex items-center gap-4 shrink-0">
          {/* Alert bell (reuses the nav-pill + pulse language) */}
          <div className="relative">
            {isAlertsOpen && <div className="fixed inset-0 z-40" onClick={() => setIsAlertsOpen(false)} />}
            <button
              onClick={openAlerts}
              className="relative p-1.5 rounded-md hover:bg-[#F4F4F5] text-[#52525B] hover:text-[#18181B] transition-colors cursor-pointer"
              title="Alerts"
            >
              <Bell className="w-4 h-4" />
              {alertCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 bg-[#DC2626] text-white text-[8px] font-bold rounded-full flex items-center justify-center border-2 border-white animate-pulse">
                  {alertCount > 99 ? '99+' : alertCount}
                </span>
              )}
            </button>

            {isAlertsOpen && (
              <div className="absolute right-0 mt-2 w-80 bg-white border border-[#E4E4E7] rounded-xl shadow-lg z-50 animate-fade-in overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#F4F4F5]">
                  <span className="text-xs font-bold text-[#18181B] flex items-center gap-1.5 font-mono uppercase tracking-wider">
                    <Bell className="w-3.5 h-3.5 text-[#DC2626]" /> Alerts ({alertCount})
                  </span>
                </div>
                <div className="max-h-[24rem] overflow-y-auto divide-y divide-[#F4F4F5]">
                  {alerts.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-[#71717A] font-light">
                      No unacknowledged alerts. Uploads with serious findings will appear here.
                    </div>
                  ) : (
                    alerts.map((a) => (
                      <div key={a.id} className="px-3.5 py-2.5 hover:bg-[#FAFAFA] space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <button onClick={() => goToAlert(a)} className="text-left flex-1 min-w-0 cursor-pointer">
                            <p className="text-[11px] font-bold text-[#18181B] leading-snug">{a.title}</p>
                            {a.detail && <p className="text-[10px] text-[#71717A] font-light truncate">{a.detail}</p>}
                          </button>
                          <button onClick={() => handleAck(a.id)} className="text-[#71717A] hover:text-emerald-600 shrink-0 p-0.5" title="Acknowledge">
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <RiskBadge tag={{ key: a.category || 'MALICIOUS', label: a.category === 'CIRCULAR' ? 'Circular Money Flow' : a.category === 'RAPID_PASSTHROUGH' ? 'Rapid Pass-Through' : `${a.severity} Risk` }} size="xs" />
                          <span className="text-[8.5px] text-[#A1A1AA] font-mono">{a.created_at?.slice(0, 16)?.replace('T', ' ')}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="hidden lg:flex items-center gap-1.5 text-xs text-[#065F46] font-medium bg-[#ECFDF5] border border-[#A7F3D0] px-2 py-0.5 rounded-full">
            <Shield className="w-3 h-3" />
            <span className="text-[10px] tracking-tight uppercase">Audit Locked</span>
          </div>
          
          <div className="flex items-center gap-3 border-l border-[#E4E4E7] pl-4">
            <div className="w-6 h-6 rounded-full bg-[#18181B] flex items-center justify-center text-white text-[10px] font-bold">
              {displayInitials}
            </div>
            <div className="hidden sm:block text-left select-none leading-none">
              <p className="text-[11px] font-semibold text-[#18181B]">{displayName}</p>
              <p className="text-[9px] text-[#71717A] mt-1">{displayDivision}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="text-[#71717A] hover:text-red-600 transition-colors p-1.5 rounded-md hover:bg-red-50 cursor-pointer ml-1"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      {/* Content Area Rendering the Selected Workspace Module */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>

    </div>
  );
}
