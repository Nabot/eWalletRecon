import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import type { CaptureDeviceDto, CaptureDeviceActivityItem, AuditLogDto } from "@ewallet/shared";
import { api, formatNad } from "../api/client";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { providerLabel } from "../lib/providers";
import { auditActionLabel, auditActorLabel } from "../lib/auditLabels";

type ProvisionResult = {
  id: string;
  name: string;
  apiKey: string;
  provisionQrPayload: string;
  provision: { v: number; apiBase: string; apiKey: string };
  reason?: "created" | "rotated" | "reshow" | "wipe";
};

type Panel = "register" | "wallets" | null;

function feedLink(walletNumberId: string, status?: string) {
  const p = new URLSearchParams();
  p.set("walletNumberId", walletNumberId);
  if (status) p.set("status", status);
  return `/?${p.toString()}`;
}

function fmtWhen(iso: string | null | undefined) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString();
}

function fmtRelative(iso: string | null | undefined) {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "never";
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 45) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function DevicesPage() {
  const { token, staff } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const isAdmin = staff?.role === "ADMIN";
  const registerRef = useRef<HTMLDivElement>(null);
  const [searchParams] = useSearchParams();

  const { data, isLoading } = useQuery({
    queryKey: ["devices"],
    queryFn: () => api.devices(token!),
    enabled: !!token,
    refetchInterval: 15_000,
  });

  const wallets = useQuery({
    queryKey: ["wallets"],
    queryFn: () => api.wallets(token!),
    enabled: !!token && isAdmin,
  });

  const [name, setName] = useState("");
  const [walletNumberId, setWalletNumberId] = useState("");
  const [siteLabel, setSiteLabel] = useState("");
  const [holderName, setHolderName] = useState("");
  const [provision, setProvision] = useState<ProvisionResult | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);

  useEffect(() => {
    const deviceId = searchParams.get("device");
    if (deviceId) setExpandedId(deviceId);
  }, [searchParams]);

  const offline = useMemo(() => (data ?? []).filter((d) => d.offlineAlert), [data]);
  const queueAlerts = useMemo(() => (data ?? []).filter((d) => d.queueAlert), [data]);
  const updateNeeded = useMemo(() => (data ?? []).filter((d) => d.updateRequired), [data]);
  const unboundWallets = useMemo(
    () => (wallets.data ?? []).filter((w) => !w.device),
    [wallets.data]
  );
  const noUnboundWallets = (wallets.data?.length ?? 0) > 0 && unboundWallets.length === 0;
  const hasAlerts = offline.length > 0 || queueAlerts.length > 0 || updateNeeded.length > 0;

  async function showProvision(
    res: Omit<ProvisionResult, "reason">,
    reason: ProvisionResult["reason"]
  ) {
    setProvision({ ...res, reason });
    try {
      const url = await QRCode.toDataURL(res.provisionQrPayload, {
        width: 280,
        margin: 2,
        errorCorrectionLevel: "M",
      });
      setQrDataUrl(url);
    } catch {
      setQrDataUrl(null);
    }
  }

  const create = useMutation({
    mutationFn: () =>
      api.createDevice(token!, name.trim(), walletNumberId, {
        siteLabel: siteLabel.trim() || undefined,
        holderName: holderName.trim() || undefined,
      }),
    onSuccess: async (res) => {
      setName("");
      setWalletNumberId("");
      setSiteLabel("");
      setHolderName("");
      setPanel(null);
      void qc.invalidateQueries({ queryKey: ["devices"] });
      void qc.invalidateQueries({ queryKey: ["wallets"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
      await showProvision(res, "created");
      push("Phone registered — scan the QR once on the handset", "success");
    },
    onError: (e: Error) => push(e.message, "error"),
  });

  useEffect(() => {
    if (!provision) setQrDataUrl(null);
  }, [provision]);

  useEffect(() => {
    if (!provision) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setProvision(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [provision]);

  function openRegister() {
    setPanel("register");
    requestAnimationFrame(() => {
      registerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      const input = registerRef.current?.querySelector<HTMLInputElement>("input");
      input?.focus();
    });
  }

  function togglePanel(next: Panel) {
    setPanel((cur) => (cur === next ? null : next));
  }

  const devices = data ?? [];
  const empty = !isLoading && devices.length === 0;
  const onlineCount = devices.filter((d) => d.online).length;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-sans font-semibold tracking-tight text-3xl text-sand-50">Phones</h2>
          <p className="text-sand-200 font-sans mt-1">
            {isLoading && !data
              ? "Loading capture handsets…"
              : devices.length === 0
                ? "Register a capture handset to receive SMS deposits"
                : `${onlineCount}/${devices.length} online · provision, sync, and wallet binding`}
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            {(wallets.data?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => togglePanel("wallets")}
                className={`rounded-md border px-3 py-1.5 text-sm font-sans hover:bg-ink-800 ${
                  panel === "wallets"
                    ? "border-veld-600 bg-veld-600/10 text-veld-400"
                    : "border-ink-700 text-sand-50"
                }`}
              >
                Wallet labels
              </button>
            )}
            <button
              type="button"
              onClick={() => (panel === "register" ? setPanel(null) : openRegister())}
              className="rounded-md bg-veld-600 hover:bg-veld-500 text-white px-3 py-1.5 text-sm font-semibold"
            >
              Add phone
            </button>
          </div>
        )}
      </div>

      {hasAlerts && (
        <div className="mb-4 rounded-lg border border-ink-700 bg-ink-900 shadow-fb divide-y divide-ink-800">
          {offline.length > 0 && (
            <div className="px-4 py-3 text-sm font-sans flex gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-clay-400" />
              <div>
                <p className="text-clay-400 font-semibold">
                  {offline.length} offline
                </p>
                <p className="text-sand-200 mt-0.5">
                  {offline.map((d) => d.name).join(", ")} — SMS capture may be delayed.
                </p>
              </div>
            </div>
          )}
          {queueAlerts.length > 0 && (
            <div className="px-4 py-3 text-sm font-sans flex gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-clay-400" />
              <div>
                <p className="text-clay-400 font-semibold">High SMS queue</p>
                <p className="text-sand-200 mt-0.5">
                  {queueAlerts.map((d) => `${d.name} (${d.pendingSmsCount})`).join(", ")} — try Force
                  sync on the phone card.
                </p>
              </div>
            </div>
          )}
          {updateNeeded.length > 0 && (
            <div className="px-4 py-3 text-sm font-sans flex gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-400" />
              <div>
                <p className="text-amber-700 font-semibold">App update required</p>
                <p className="text-sand-200 mt-0.5">
                  {updateNeeded
                    .map((d) => `${d.name} (v${d.appVersionName ?? d.appVersionCode ?? "?"})`)
                    .join(", ")}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {isAdmin && panel === "register" && (
        <div
          ref={registerRef}
          id="register-phone"
          className="mb-4 border border-ink-700 rounded-lg p-4 bg-ink-900 shadow-fb"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-sans font-semibold text-sand-50">Register phone</h3>
              <p className="text-sm text-sand-200 mt-1">
                Creates a key. Scan the QR on the handset — connection locks after first success.
              </p>
            </div>
            <button
              type="button"
              className="text-sm text-sand-200 hover:text-sand-50 shrink-0"
              onClick={() => setPanel(null)}
            >
              Close
            </button>
          </div>
          {noUnboundWallets ? (
            <p className="mt-3 text-sm text-sand-200 font-sans">
              All wallets have a phone. Revoke or rebind an existing phone first.
            </p>
          ) : (
            <div className="mt-3 grid sm:grid-cols-2 gap-3 font-sans text-sm">
              <label className="block">
                <span className="text-xs text-sand-200">Phone name</span>
                <input
                  className="mt-1 w-full rounded-md bg-ink-950 border border-ink-700 px-2 py-1.5"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Phone-PayPulse-2"
                />
              </label>
              <label className="block">
                <span className="text-xs text-sand-200">Wallet phone</span>
                <select
                  className="mt-1 w-full rounded-md bg-ink-950 border border-ink-700 px-2 py-1.5"
                  value={walletNumberId}
                  onChange={(e) => setWalletNumberId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {unboundWallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label} ({w.msisdn})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-sand-200">Site label (optional)</span>
                <input
                  className="mt-1 w-full rounded-md bg-ink-950 border border-ink-700 px-2 py-1.5"
                  value={siteLabel}
                  onChange={(e) => setSiteLabel(e.target.value)}
                  placeholder="Windhoek till 2"
                />
              </label>
              <label className="block">
                <span className="text-xs text-sand-200">Holder (optional)</span>
                <input
                  className="mt-1 w-full rounded-md bg-ink-950 border border-ink-700 px-2 py-1.5"
                  value={holderName}
                  onChange={(e) => setHolderName(e.target.value)}
                  placeholder="Who holds the handset"
                />
              </label>
              <div className="sm:col-span-2 flex justify-end">
                <button
                  type="button"
                  disabled={
                    create.isPending || !name.trim() || !walletNumberId || unboundWallets.length === 0
                  }
                  onClick={() => create.mutate()}
                  className="rounded-md bg-veld-600 hover:bg-veld-500 text-white px-3 py-1.5 font-semibold disabled:opacity-50"
                >
                  {create.isPending ? "Creating…" : "Create & show QR"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isAdmin && panel === "wallets" && (wallets.data?.length ?? 0) > 0 && (
        <div className="mb-4 border border-ink-700 rounded-lg p-4 bg-ink-900 shadow-fb">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-sans font-semibold text-sand-50">Wallet labels</h3>
              <p className="text-sm text-sand-200 mt-1">
                Rename display labels. Provider and MSISDN stay the same.
              </p>
            </div>
            <button
              type="button"
              className="text-sm text-sand-200 hover:text-sand-50 shrink-0"
              onClick={() => setPanel(null)}
            >
              Close
            </button>
          </div>
          <ul className="mt-3 space-y-2">
            {(wallets.data ?? []).map((w) => (
              <WalletRenameRow key={w.id} wallet={w} token={token!} onToast={push} />
            ))}
          </ul>
        </div>
      )}

      {provision && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setProvision(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="provision-title"
            className="w-full max-w-lg rounded-lg border border-ink-700 bg-ink-900 p-5 shadow-fb-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="provision-title" className="font-sans text-xl font-semibold text-sand-50">
              {provision.reason === "rotated"
                ? "Scan new key once"
                : provision.reason === "wipe"
                  ? "Wipe issued — scan to re-link"
                  : provision.reason === "reshow"
                    ? "Provision QR"
                    : "Provision once"}
            </h3>
            <p className="mt-1 text-sm text-clay-400 font-sans font-semibold">
              Scan on the handset (or copy the payload). Available until the phone heartbeats with this
              key.
            </p>
            <p className="mt-2 text-sm text-sand-200">
              Handset: <span className="font-semibold text-sand-50">{provision.name}</span>
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-4 items-center">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Phone provision QR"
                  className="rounded-md border border-ink-700 bg-white p-2 w-[200px] h-[200px]"
                />
              ) : (
                <div className="w-[200px] h-[200px] border border-ink-700 rounded-md flex items-center justify-center text-sm text-sand-200">
                  QR unavailable
                </div>
              )}
              <div className="flex-1 space-y-2 text-sm font-sans min-w-0">
                <div>
                  <div className="text-xs text-sand-200">API base</div>
                  <code className="font-mono text-xs break-all">{provision.provision.apiBase}</code>
                </div>
                <div>
                  <div className="text-xs text-sand-200">Device key</div>
                  <code className="font-mono text-xs break-all">{provision.apiKey}</code>
                </div>
                <button
                  type="button"
                  className="rounded-md border border-ink-700 px-3 py-1.5 text-xs hover:bg-ink-800"
                  onClick={async () => {
                    await navigator.clipboard.writeText(provision.provisionQrPayload);
                    push("Provision JSON copied", "success");
                  }}
                >
                  Copy JSON payload
                </button>
              </div>
            </div>
            <button
              type="button"
              className="mt-5 w-full rounded-md bg-veld-600 hover:bg-veld-500 text-white py-2 font-semibold"
              onClick={() => setProvision(null)}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {isLoading && !data && <p className="text-sand-200">Loading…</p>}

      {empty && panel !== "register" && (
        <div className="border border-ink-700 rounded-lg p-8 bg-ink-900 text-center font-sans">
          <p className="text-sand-50 font-semibold text-lg">No phones registered</p>
          {isAdmin ? (
            <>
              <p className="mt-1 text-sm text-sand-200">
                Register a capture phone to start receiving SMS deposits.
              </p>
              <button
                type="button"
                onClick={openRegister}
                className="mt-4 rounded-md bg-veld-600 hover:bg-veld-500 text-white px-4 py-2 text-sm font-semibold"
              >
                Register a phone
              </button>
            </>
          ) : (
            <p className="mt-1 text-sm text-sand-200">
              Ask an admin to register a capture phone for the wallet you need.
            </p>
          )}
        </div>
      )}

      <div className="space-y-3">
        {devices.map((d) => (
          <DeviceCard
            key={d.id}
            device={d}
            isAdmin={isAdmin}
            token={token!}
            expanded={expandedId === d.id}
            onToggleExpand={() => setExpandedId((id) => (id === d.id ? null : d.id))}
            unboundWallets={unboundWallets}
            allWallets={wallets.data ?? []}
            onProvision={showProvision}
            onToast={push}
          />
        ))}
      </div>
    </div>
  );
}

function WalletRenameRow({
  wallet: w,
  token,
  onToast,
}: {
  wallet: {
    id: string;
    msisdn: string;
    label: string;
    provider: string;
    device?: { id: string; name: string; lastSeenAt: string | null } | null;
  };
  token: string;
  onToast: (msg: string, kind: "success" | "error" | "info") => void;
}) {
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(w.label);

  const rename = useMutation({
    mutationFn: (nextLabel: string) => api.renameWallet(token, w.id, nextLabel),
    onSuccess: () => {
      setRenaming(false);
      void qc.invalidateQueries({ queryKey: ["wallets"] });
      void qc.invalidateQueries({ queryKey: ["devices"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
      onToast("Wallet renamed", "success");
    },
    onError: (e: Error) => onToast(e.message, "error"),
  });

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-ink-800 bg-ink-950/80 px-3 py-2">
      {renaming ? (
        <form
          className="flex flex-1 min-w-[12rem] gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const next = renameValue.trim();
            if (!next || next === w.label) {
              setRenaming(false);
              setRenameValue(w.label);
              return;
            }
            rename.mutate(next);
          }}
        >
          <input
            autoFocus
            className="flex-1 min-w-0 rounded-md bg-ink-900 border border-ink-700 px-2 py-1 text-sm"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setRenaming(false);
                setRenameValue(w.label);
              }
            }}
            maxLength={120}
          />
          <button
            type="submit"
            disabled={rename.isPending}
            className="rounded-md bg-veld-600 px-2 py-1 text-xs text-white font-semibold disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            className="rounded-md border border-ink-700 px-2 py-1 text-xs hover:bg-ink-800"
            onClick={() => {
              setRenaming(false);
              setRenameValue(w.label);
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            <p className="font-sans font-semibold text-sand-50 truncate">{w.label}</p>
            <p className="font-mono text-[11px] text-sand-200 mt-0.5">
              {providerLabel(w.provider)} · {w.msisdn}
              {w.device ? ` · ${w.device.name}` : " · unbound"}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-ink-700 px-2 py-1 text-xs hover:bg-ink-800 shrink-0"
            onClick={() => {
              setRenameValue(w.label);
              setRenaming(true);
            }}
          >
            Rename
          </button>
        </>
      )}
    </li>
  );
}

function StatusChip({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "bad" | "neutral";
  children: ReactNode;
}) {
  const cls =
    tone === "ok"
      ? "bg-veld-600/10 text-veld-700 border-veld-600/25"
      : tone === "warn"
        ? "bg-amber-500/10 text-amber-800 border-amber-500/30"
        : tone === "bad"
          ? "bg-clay-600/10 text-clay-500 border-clay-500/30"
          : "bg-ink-950 text-sand-200 border-ink-800";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-sans font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

function DeviceCard({
  device: d,
  isAdmin,
  token,
  expanded,
  onToggleExpand,
  unboundWallets,
  allWallets,
  onProvision,
  onToast,
}: {
  device: CaptureDeviceDto;
  isAdmin: boolean;
  token: string;
  expanded: boolean;
  onToggleExpand: () => void;
  unboundWallets: { id: string; label: string; msisdn: string }[];
  allWallets: { id: string; label: string; msisdn: string; device?: { id: string } | null }[];
  onProvision: (
    res: Omit<ProvisionResult, "reason">,
    reason: ProvisionResult["reason"]
  ) => Promise<void>;
  onToast: (msg: string, kind: "success" | "error" | "info") => void;
}) {
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(d.name);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState({
    siteLabel: d.siteLabel ?? "",
    holderName: d.holderName ?? "",
    simMsisdn: d.simMsisdn ?? "",
    notes: d.notes ?? "",
  });
  const [rebindWalletId, setRebindWalletId] = useState("");
  const [showDanger, setShowDanger] = useState(false);

  const activity = useQuery({
    queryKey: ["device-activity", d.id],
    queryFn: () => api.deviceActivity(token, d.id, 6),
    enabled: expanded,
  });
  const audit = useQuery({
    queryKey: ["device-audit", d.id],
    queryFn: () => api.deviceAudit(token, d.id, 10),
    enabled: expanded,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["devices"] });
    void qc.invalidateQueries({ queryKey: ["wallets"] });
    void qc.invalidateQueries({ queryKey: ["device-activity", d.id] });
    void qc.invalidateQueries({ queryKey: ["device-audit", d.id] });
    void qc.invalidateQueries({ queryKey: ["audit"] });
  };

  const rename = useMutation({
    mutationFn: (nextName: string) => api.renameDevice(token, d.id, nextName),
    onSuccess: () => {
      setRenaming(false);
      invalidate();
      onToast("Phone renamed", "success");
    },
    onError: (e: Error) => onToast(e.message, "error"),
  });

  const saveNotes = useMutation({
    mutationFn: () =>
      api.updateDevice(token, d.id, {
        siteLabel: notesDraft.siteLabel.trim() || null,
        holderName: notesDraft.holderName.trim() || null,
        simMsisdn: notesDraft.simMsisdn.trim() || null,
        notes: notesDraft.notes.trim() || null,
      }),
    onSuccess: () => {
      setEditingNotes(false);
      invalidate();
      onToast("Notes saved", "success");
    },
    onError: (e: Error) => onToast(e.message, "error"),
  });

  const rebind = useMutation({
    mutationFn: (walletNumberId: string) => api.updateDevice(token, d.id, { walletNumberId }),
    onSuccess: () => {
      setRebindWalletId("");
      invalidate();
      onToast("Phone rebound to wallet", "success");
    },
    onError: (e: Error) => onToast(e.message, "error"),
  });

  const rotate = useMutation({
    mutationFn: () => api.rotateDeviceKey(token, d.id),
    onSuccess: async (res) => {
      invalidate();
      await onProvision(res, "rotated");
      onToast("New key issued — scan QR on the phone", "success");
    },
    onError: (e: Error) => onToast(e.message, "error"),
  });

  const reshow = useMutation({
    mutationFn: () => api.showDeviceProvision(token, d.id),
    onSuccess: async (res) => {
      await onProvision(res, "reshow");
    },
    onError: (e: Error) => onToast(e.message, "error"),
  });

  const forceSync = useMutation({
    mutationFn: () => api.forceDeviceSync(token, d.id),
    onSuccess: () => {
      invalidate();
      onToast("Force sync queued — phone will sync on next heartbeat", "success");
    },
    onError: (e: Error) => onToast(e.message, "error"),
  });

  const ping = useMutation({
    mutationFn: () => api.pingDevice(token, d.id),
    onSuccess: () => {
      invalidate();
      onToast("Ping sent — waiting for phone pong", "info");
    },
    onError: (e: Error) => onToast(e.message, "error"),
  });

  const wipe = useMutation({
    mutationFn: () => api.wipeDevice(token, d.id),
    onSuccess: () => {
      invalidate();
      onToast("Wipe requested — phone clears key on next heartbeat; then Show QR", "success");
    },
    onError: (e: Error) => onToast(e.message, "error"),
  });

  const revoke = useMutation({
    mutationFn: () => api.revokeDevice(token, d.id),
    onSuccess: () => {
      invalidate();
      onToast("Phone revoked", "success");
    },
    onError: (e: Error) => onToast(e.message, "error"),
  });

  const rebindOptions = allWallets.filter(
    (w) => w.id === d.walletNumberId || !w.device || unboundWallets.some((u) => u.id === w.id)
  );

  const pendingCmds = [
    d.syncRequested ? "sync" : null,
    d.wipeRequested ? "wipe" : null,
    d.pingRequested ? "ping" : null,
  ].filter(Boolean) as string[];

  const hasIssue =
    !d.online ||
    d.updateRequired ||
    d.queueAlert ||
    !!d.lastError ||
    d.smsPermissionOk === false ||
    pendingCmds.length > 0;

  return (
    <div
      className={`border rounded-lg bg-ink-900 shadow-fb overflow-hidden ${
        d.online ? "border-ink-700" : "border-clay-500/35"
      }`}
    >
      {/* Compact identity row */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {renaming ? (
              <form
                className="flex gap-1 max-w-md"
                onSubmit={(e) => {
                  e.preventDefault();
                  const next = renameValue.trim();
                  if (!next || next === d.name) {
                    setRenaming(false);
                    return;
                  }
                  rename.mutate(next);
                }}
              >
                <input
                  autoFocus
                  className="flex-1 min-w-0 rounded-md bg-ink-950 border border-ink-700 px-2 py-1 text-sm"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setRenaming(false);
                  }}
                />
                <button
                  type="submit"
                  disabled={rename.isPending}
                  className="rounded-md bg-veld-600 px-2 py-1 text-xs text-white font-semibold disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  className="rounded-md border border-ink-700 px-2 py-1 text-xs hover:bg-ink-800"
                  onClick={() => setRenaming(false)}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <h3 className="font-sans font-semibold text-sand-50 truncate text-lg leading-tight">
                {d.name}
              </h3>
            )}
            <p className="mt-1 text-sm text-sand-200 font-sans truncate">
              {d.walletNumber?.label ?? "—"}
              {d.walletNumber?.provider ? ` · ${providerLabel(d.walletNumber.provider)}` : ""}
              {d.walletNumber?.msisdn ? (
                <span className="font-mono text-xs"> · {d.walletNumber.msisdn}</span>
              ) : null}
            </p>
            {(d.siteLabel || d.holderName) && (
              <p className="mt-0.5 text-xs text-sand-200/80 font-sans truncate">
                {[d.siteLabel, d.holderName].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-sans font-semibold ${
                d.online
                  ? "bg-veld-600/10 text-veld-700"
                  : "bg-clay-600/10 text-clay-500"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${d.online ? "bg-veld-500" : "bg-clay-400"}`} />
              {d.online ? "Online" : "Offline"}
            </span>
            <p className="mt-1.5 text-[11px] font-mono text-sand-200" title={fmtWhen(d.lastSeenAt)}>
              Seen {fmtRelative(d.lastSeenAt)}
            </p>
          </div>
        </div>

        {hasIssue && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {d.updateRequired && <StatusChip tone="warn">Update required</StatusChip>}
            {(d.queueAlert || d.pendingSmsCount > 0) && (
              <StatusChip tone={d.queueAlert ? "bad" : "neutral"}>
                Queue {d.pendingSmsCount}
              </StatusChip>
            )}
            {d.smsPermissionOk === false && <StatusChip tone="bad">SMS permission missing</StatusChip>}
            {pendingCmds.length > 0 && (
              <StatusChip tone="neutral">Pending: {pendingCmds.join(", ")}</StatusChip>
            )}
            {d.lastError && (
              <StatusChip tone="bad">
                Error · {fmtRelative(d.lastErrorAt)}
              </StatusChip>
            )}
          </div>
        )}
        {d.lastError && (
          <p className="mt-2 text-xs text-clay-400 font-sans break-words line-clamp-2" title={d.lastError}>
            {d.lastError}
          </p>
        )}

        {/* Primary actions — only everyday ops */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {isAdmin && (
            <>
              <button
                type="button"
                disabled={forceSync.isPending}
                className="rounded-md bg-veld-600 hover:bg-veld-500 text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                onClick={() => forceSync.mutate()}
              >
                {forceSync.isPending ? "Queuing…" : "Force sync"}
              </button>
              <button
                type="button"
                disabled={ping.isPending}
                className="rounded-md border border-ink-700 px-3 py-1.5 text-xs font-sans hover:bg-ink-800 disabled:opacity-50"
                onClick={() => ping.mutate()}
              >
                Ping
              </button>
              {d.hasPendingProvision && (
                <button
                  type="button"
                  disabled={reshow.isPending}
                  className="rounded-md border border-ink-700 px-3 py-1.5 text-xs font-sans hover:bg-ink-800 disabled:opacity-50"
                  onClick={() => reshow.mutate()}
                >
                  Show QR
                </button>
              )}
            </>
          )}
          <Link
            to={feedLink(d.walletNumberId)}
            className="rounded-md border border-ink-700 px-3 py-1.5 text-xs font-sans hover:bg-ink-800 text-sand-50"
          >
            Live feed
          </Link>
          <Link
            to={feedLink(d.walletNumberId, "PENDING")}
            className="rounded-md border border-ink-700 px-3 py-1.5 text-xs font-sans hover:bg-ink-800 text-sand-50"
          >
            Pending
          </Link>
          <button
            type="button"
            className={`ml-auto rounded-md px-3 py-1.5 text-xs font-sans ${
              expanded
                ? "bg-ink-800 text-sand-50"
                : "border border-ink-700 text-sand-200 hover:bg-ink-800 hover:text-sand-50"
            }`}
            onClick={onToggleExpand}
            aria-expanded={expanded}
          >
            {expanded ? "Hide details" : "Details"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-ink-700 bg-ink-950/40 px-4 py-4 space-y-5">
          {/* Health metrics — only in details */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-sand-200 mb-2">Health</p>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-sans">
              <div className="rounded-md border border-ink-800 bg-ink-900 px-2.5 py-2">
                <dt className="text-sand-200">App</dt>
                <dd className="font-mono text-sand-50 mt-0.5">
                  {d.appVersionName ? `v${d.appVersionName}` : "—"}
                </dd>
              </div>
              <div className="rounded-md border border-ink-800 bg-ink-900 px-2.5 py-2">
                <dt className="text-sand-200">Queue</dt>
                <dd className="font-mono text-sand-50 mt-0.5">{d.pendingSmsCount}</dd>
              </div>
              <div className="rounded-md border border-ink-800 bg-ink-900 px-2.5 py-2">
                <dt className="text-sand-200">SMS permission</dt>
                <dd className="font-mono text-sand-50 mt-0.5">
                  {d.smsPermissionOk == null ? "—" : d.smsPermissionOk ? "OK" : "missing"}
                </dd>
              </div>
              <div className="rounded-md border border-ink-800 bg-ink-900 px-2.5 py-2">
                <dt className="text-sand-200">Last seen</dt>
                <dd className="font-mono text-sand-50 mt-0.5 text-[11px]">{fmtWhen(d.lastSeenAt)}</dd>
              </div>
              <div className="rounded-md border border-ink-800 bg-ink-900 px-2.5 py-2">
                <dt className="text-sand-200">Last sync</dt>
                <dd className="font-mono text-sand-50 mt-0.5 text-[11px]">{fmtWhen(d.lastSyncAt)}</dd>
              </div>
              <div className="rounded-md border border-ink-800 bg-ink-900 px-2.5 py-2">
                <dt className="text-sand-200">Last pong</dt>
                <dd className="font-mono text-sand-50 mt-0.5 text-[11px]">{fmtWhen(d.lastPongAt)}</dd>
              </div>
              {d.simMsisdn && (
                <div className="rounded-md border border-ink-800 bg-ink-900 px-2.5 py-2 sm:col-span-3">
                  <dt className="text-sand-200">SIM MSISDN</dt>
                  <dd className="font-mono text-sand-50 mt-0.5">{d.simMsisdn}</dd>
                </div>
              )}
            </dl>
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-sand-200 mb-2">
                Recent SMS / deposits
              </p>
              {(activity.data ?? []).length === 0 && !activity.isLoading && (
                <p className="text-sm text-sand-200">No captures yet for this wallet.</p>
              )}
              <ul className="space-y-1.5">
                {(activity.data ?? []).map((a: CaptureDeviceActivityItem) => (
                  <li
                    key={a.id}
                    className="rounded-md bg-ink-900 border border-ink-800 px-2.5 py-2 text-xs"
                  >
                    <div className="flex justify-between gap-2">
                      <span className="font-mono text-sand-50">{formatNad(a.amount)}</span>
                      <span className="text-sand-200">{a.matchStatus}</span>
                    </div>
                    <p className="text-sand-200 mt-0.5 truncate">
                      {(a.senderName || a.senderMsisdn || "—") +
                        (a.reference ? ` · ${a.reference}` : "")}
                    </p>
                    <p className="text-sand-200/70 mt-0.5 font-mono">{fmtWhen(a.receivedAt)}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-sand-200">
                  Device audit
                </p>
                <Link
                  to={`/audit?entityType=CaptureDevice&entityId=${encodeURIComponent(d.id)}`}
                  className="text-xs text-veld-400 hover:underline"
                >
                  Full trail
                </Link>
              </div>
              <ul className="space-y-1.5">
                {(audit.data ?? []).map((log: AuditLogDto) => (
                  <li
                    key={log.id}
                    className="rounded-md bg-ink-900 border border-ink-800 px-2.5 py-2 text-xs"
                  >
                    <div className="flex justify-between gap-2">
                      <span className="text-sand-50">{auditActionLabel(log.action)}</span>
                      <span className="font-mono shrink-0 text-sand-200">{fmtWhen(log.createdAt)}</span>
                    </div>
                    <p className="text-sand-200 mt-0.5">
                      {auditActorLabel(log)}
                      <span className="text-sand-200/50 font-mono uppercase text-[10px] ml-1.5">
                        {log.actorType}
                      </span>
                    </p>
                  </li>
                ))}
                {(audit.data ?? []).length === 0 && !audit.isLoading && (
                  <li className="text-sm text-sand-200">No device events yet.</li>
                )}
              </ul>
            </div>
          </div>

          {isAdmin && (
            <div className="border-t border-ink-800 pt-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-sand-200">Manage</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-ink-700 px-2.5 py-1.5 text-xs hover:bg-ink-800"
                  onClick={() => {
                    setRenaming(true);
                    setRenameValue(d.name);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="rounded-md border border-ink-700 px-2.5 py-1.5 text-xs hover:bg-ink-800"
                  onClick={() => {
                    setEditingNotes((v) => !v);
                    setNotesDraft({
                      siteLabel: d.siteLabel ?? "",
                      holderName: d.holderName ?? "",
                      simMsisdn: d.simMsisdn ?? "",
                      notes: d.notes ?? "",
                    });
                  }}
                >
                  {editingNotes ? "Close notes" : "Edit notes"}
                </button>
                {!d.hasPendingProvision && (
                  <button
                    type="button"
                    disabled={reshow.isPending}
                    title="No pending key — rotate to issue a new one"
                    className="rounded-md border border-ink-700 px-2.5 py-1.5 text-xs hover:bg-ink-800 disabled:opacity-40"
                    onClick={() => reshow.mutate()}
                  >
                    Show QR
                  </button>
                )}
                <button
                  type="button"
                  className={`rounded-md border px-2.5 py-1.5 text-xs hover:bg-ink-800 ${
                    showDanger
                      ? "border-clay-500/40 text-clay-400"
                      : "border-ink-700"
                  }`}
                  onClick={() => setShowDanger((v) => !v)}
                >
                  {showDanger ? "Hide advanced" : "Advanced…"}
                </button>
              </div>

              {editingNotes && (
                <div className="grid sm:grid-cols-2 gap-2">
                  <input
                    className="rounded-md bg-ink-900 border border-ink-700 px-2 py-1.5 text-xs"
                    placeholder="Site label"
                    value={notesDraft.siteLabel}
                    onChange={(e) => setNotesDraft((s) => ({ ...s, siteLabel: e.target.value }))}
                  />
                  <input
                    className="rounded-md bg-ink-900 border border-ink-700 px-2 py-1.5 text-xs"
                    placeholder="Holder name"
                    value={notesDraft.holderName}
                    onChange={(e) => setNotesDraft((s) => ({ ...s, holderName: e.target.value }))}
                  />
                  <input
                    className="rounded-md bg-ink-900 border border-ink-700 px-2 py-1.5 text-xs"
                    placeholder="SIM MSISDN"
                    value={notesDraft.simMsisdn}
                    onChange={(e) => setNotesDraft((s) => ({ ...s, simMsisdn: e.target.value }))}
                  />
                  <textarea
                    className="sm:col-span-2 rounded-md bg-ink-900 border border-ink-700 px-2 py-1.5 text-xs min-h-[56px]"
                    placeholder="Notes"
                    value={notesDraft.notes}
                    onChange={(e) => setNotesDraft((s) => ({ ...s, notes: e.target.value }))}
                  />
                  <button
                    type="button"
                    disabled={saveNotes.isPending}
                    className="rounded-md bg-veld-600 px-2.5 py-1.5 text-xs text-white font-semibold disabled:opacity-50"
                    onClick={() => saveNotes.mutate()}
                  >
                    Save notes
                  </button>
                </div>
              )}

              {showDanger && (
                <div className="rounded-md border border-clay-500/25 bg-clay-600/5 p-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="rounded-md bg-ink-900 border border-ink-700 px-2 py-1.5 text-xs min-w-[10rem]"
                      value={rebindWalletId}
                      onChange={(e) => setRebindWalletId(e.target.value)}
                    >
                      <option value="">Rebind wallet…</option>
                      {rebindOptions.map((w) => (
                        <option key={w.id} value={w.id} disabled={w.id === d.walletNumberId}>
                          {w.label} ({w.msisdn})
                          {w.id === d.walletNumberId ? " — current" : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!rebindWalletId || rebind.isPending}
                      className="rounded-md border border-ink-700 px-2.5 py-1.5 text-xs hover:bg-ink-800 disabled:opacity-40"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Move “${d.name}” to another wallet? Deposits will bind to the new wallet going forward.`
                          )
                        ) {
                          return;
                        }
                        rebind.mutate(rebindWalletId);
                      }}
                    >
                      Rebind
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={rotate.isPending}
                      className="rounded-md border border-ink-700 px-2.5 py-1.5 text-xs hover:bg-ink-800 disabled:opacity-50"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Rotate API key for “${d.name}”? The phone will go offline until it scans the new QR.`
                          )
                        ) {
                          return;
                        }
                        rotate.mutate();
                      }}
                    >
                      Rotate key
                    </button>
                    <button
                      type="button"
                      disabled={wipe.isPending}
                      className="rounded-md border border-clay-500/40 px-2.5 py-1.5 text-xs text-clay-400 hover:bg-clay-600/15 disabled:opacity-50"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Remote wipe “${d.name}”? The phone will clear its sealed key on next heartbeat. A new QR will be available after wipe is delivered.`
                          )
                        ) {
                          return;
                        }
                        wipe.mutate();
                      }}
                    >
                      Wipe
                    </button>
                    <button
                      type="button"
                      disabled={revoke.isPending}
                      className="rounded-md border border-clay-500/40 px-2.5 py-1.5 text-xs text-clay-400 hover:bg-clay-600/15 disabled:opacity-50"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Revoke “${d.name}”? This frees the wallet binding. The phone can no longer capture SMS.`
                          )
                        ) {
                          return;
                        }
                        revoke.mutate();
                      }}
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
