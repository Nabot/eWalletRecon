import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { api } from "../api/client";
import { useRealtimeStatus } from "../hooks/useRealtime";

const links: {
  to: string;
  label: string;
  short: string;
  end?: boolean;
  badge?: "pending" | "offline";
}[] = [
  { to: "/", label: "Live feed", short: "Feed", end: true },
  { to: "/exceptions?focus=oldest", label: "Pending credits", short: "Pending", badge: "pending" },
  { to: "/reports", label: "Reports", short: "Reports" },
  { to: "/devices", label: "Phones", short: "Phones", badge: "offline" },
  { to: "/audit", label: "Audit", short: "Audit" },
];

function initials(email?: string | null) {
  if (!email) return "?";
  const local = email.split("@")[0] ?? email;
  return local.slice(0, 2).toUpperCase();
}

export default function Layout() {
  const { token, staff, logout } = useAuth();
  const live = useRealtimeStatus();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pending = useQuery({
    queryKey: ["pending-count"],
    queryFn: () => api.pendingCount(token!),
    enabled: !!token,
    refetchInterval: 15_000,
  });
  const devices = useQuery({
    queryKey: ["devices"],
    queryFn: () => api.devices(token!),
    enabled: !!token,
    refetchInterval: 15_000,
  });

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pendingCount = pending.data?.count ?? 0;
  const offlineCount = (devices.data ?? []).filter((d) => !d.online).length;

  function badgeCount(kind?: "pending" | "offline") {
    if (kind === "pending") return pendingCount;
    if (kind === "offline") return offlineCount;
    return 0;
  }

  function linkClass(isActive: boolean) {
    return `inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-sans rounded-md transition whitespace-nowrap ${
      isActive
        ? "bg-veld-600/30 text-veld-400 font-semibold"
        : "text-sand-200 hover:text-sand-50 hover:bg-ink-800"
    }`;
  }

  return (
    <div className="min-h-screen flex flex-col pb-16 md:pb-0">
      <header className="border-b border-ink-700 bg-ink-900 sticky top-0 z-20">
        <div className="mx-auto max-w-7xl px-3 sm:px-4 h-14 flex items-center gap-3">
          <div className="min-w-0 shrink">
            <p className="font-sans text-lg sm:text-xl font-semibold tracking-tight text-sand-50 leading-tight truncate">
              E-Wallet Recon
            </p>
            <p className="hidden sm:flex text-xs text-sand-200 font-sans items-center gap-2">
              NAD
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wide ${
                  live.connected ? "text-veld-400" : "text-sand-200"
                }`}
                title={live.connected ? "Realtime connected" : "Realtime disconnected"}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    live.connected ? "bg-veld-400 animate-pulse" : "bg-ink-700"
                  }`}
                />
                {live.connected ? "Live" : "Offline"}
              </span>
            </p>
          </div>

          <nav className="hidden md:flex flex-1 items-center justify-center gap-0.5 min-w-0 overflow-x-auto">
            {links.map((l) => {
              const count = badgeCount(l.badge);
              return (
                <NavLink key={l.label} to={l.to} end={l.end} className={({ isActive }) => linkClass(isActive)}>
                  {l.label}
                  {count > 0 && (
                    <span className="min-w-[1.25rem] rounded-full bg-clay-500 px-1.5 text-center text-[10px] font-mono text-white">
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2 relative" ref={menuRef}>
            <span
              className={`md:hidden inline-flex items-center gap-1 text-[10px] font-mono uppercase ${
                live.connected ? "text-veld-400" : "text-sand-200"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  live.connected ? "bg-veld-400 animate-pulse" : "bg-ink-700"
                }`}
              />
            </span>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="inline-flex items-center gap-2 rounded-full border border-ink-700 pl-1 pr-2.5 py-1 hover:bg-ink-800"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-veld-600 text-white text-xs font-semibold">
                {initials(staff?.email)}
              </span>
              <span className="hidden lg:inline text-sm font-sans text-sand-50 max-w-[10rem] truncate">
                {staff?.role}
              </span>
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1.5 w-56 rounded-lg border border-ink-700 bg-ink-900 shadow-fb-md p-2 z-30"
              >
                <p className="px-2 py-1.5 text-xs text-sand-200 font-sans truncate">{staff?.email}</p>
                <p className="px-2 pb-2 text-xs font-mono text-sand-50">{staff?.role}</p>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    logout();
                  }}
                  className="w-full rounded-md px-2 py-2 text-left text-sm font-sans hover:bg-ink-800"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-7xl px-3 sm:px-4 py-5 sm:py-6">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 border-t border-ink-700 bg-ink-900 safe-bottom">
        <div className="grid grid-cols-5 gap-0">
          {links.map((l) => {
            const count = badgeCount(l.badge);
            return (
              <NavLink
                key={l.label}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  `relative flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-sans ${
                    isActive ? "text-veld-400 font-semibold" : "text-sand-200"
                  }`
                }
              >
                <span>{l.short}</span>
                {count > 0 && (
                  <span className="absolute top-1 right-[18%] min-w-[1rem] rounded-full bg-clay-500 px-1 text-center text-[9px] font-mono text-white leading-4">
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
