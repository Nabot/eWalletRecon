import { useEffect, useMemo, useRef, useState } from "react";
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

  function scrollToRegister() {
    registerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const input = registerRef.current?.querySelector<HTMLInputElement>("input");
    input?.focus();
  }

  const devices = data ?? [];
  const empty = !isLoading && devices.length === 0;

  return (
    <div>
      <div className="mb-6">
        <h2 className="font-sans font-semibold tracking-tight text-3xl text-sand-50">Phones</h2>
        <p className="text-sand-200 font-sans mt-1">
          Capture handset health, provision QR, sync wake, and wallet binding
        </p>
      </div>

      {offline.length > 0 && (
        <div className="mb-3 rounded-md border border-clay-500/40 bg-clay-600/15 px-4 py-3 text-sm font-sans">
          <p className="text-clay-400 font-semibold">
            {offline.length} phone{offline.length === 1 ? "" : "s"} offline
          </p>
          <p className="text-sand-200 mt-1">
            {offline.map((d) => d.name).join(", ")} — SMS capture may be delayed.
          </p>
        </div>
      )}
      {queueAlerts.length > 0 && (
        <div className="mb-3 rounded-md border border-clay-500/40 bg-clay-600/15 px-4 py-3 text-sm font-sans">
          <p className="text-clay-400 font-semibold">High pending SMS queue</p>
          <p className="text-sand-200 mt-1">
            {queueAlerts.map((d) => `${d.name} (${d.pendingSmsCount})`).join(", ")} — try Force sync.
          </p>
        </div>
      )}
      {updateNeeded.length > 0 && (
        <div className="mb-3 rounded-md border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm font-sans">
          <p className="text-amber-200 font-semibold">App update required</p>
          <p className="text-sand-200 mt-1">
            {updateNeeded.map((d) => `${d.name} (v${d.appVersionName ?? d.appVersionCode ?? "?"})`).join(", ")}
          </p>
        </div>
      )}

      {isAdmin && (
        <div
          ref={registerRef}
          id="register-phone"
          className="mb-6 border border-ink-700 rounded-lg p-4 bg-ink-900 shadow-fb"
        >
          <h3 className="font-sans font-semibold text-sand-50">Register phone</h3>
          <p className="text-sm text-sand-200 mt-1">
            Creates a key. Scan the QR on the handset — connection locks after first success. QR can be
            re-shown until the phone heartbeats.
          </p>
          {noUnboundWallets ? (
            <p className="mt-3 text-sm text-sand-200 font-sans">
              All wallets have a phone. Revoke or rebind an existing phone first.
            </p>
          ) : (
            <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-4 gap-2 font-sans text-sm">
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
              <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
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

      {isAdmin && (wallets.data?.length ?? 0) > 0 && (
        <div className="mb-6 border border-ink-700 rounded-lg p-4 bg-ink-900 shadow-fb">
          <h3 className="font-sans font-semibold text-sand-50">Wallet numbers</h3>
          <p className="text-sm text-sand-200 mt-1">
            Rename the display label for each receiving wallet phone. Provider and MSISDN stay the same.
          </p>
          <ul className="mt-3 space-y-2">
            {(wallets.data ?? []).map((w) => (
              <WalletRenameRow
                key={w.id}
                wallet={w}
                token={token!}
                onToast={push}
              />
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

      {empty && (
        <div className="border border-ink-700 rounded-lg p-6 bg-ink-900 text-center font-sans">
          <p className="text-sand-50 font-semibold">No phones registered</p>
          {isAdmin ? (
            <>
              <p className="mt-1 text-sm text-sand-200">
                Register a capture phone to start receiving SMS deposits.
              </p>
              <button
                type="button"
                onClick={scrollToRegister}
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

      <div className="grid lg:grid-cols-2 gap-4">
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

  return (
    <div
      className={`border rounded-lg p-4 bg-ink-900 shadow-fb ${
        d.online ? "border-ink-700" : "border-clay-500/35"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        {renaming ? (
          <form
            className="flex-1 flex gap-1 min-w-0"
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
          </form>
        ) : (
          <h3 className="font-sans font-semibold text-sand-50 truncate">{d.name}</h3>
        )}
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-mono shrink-0 ${
            d.online ? "text-veld-400" : "text-clay-400"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${d.online ? "bg-veld-400" : "bg-clay-400"}`} />
          {d.online ? "ONLINE" : "OFFLINE"}
        </span>
      </div>

      {(d.siteLabel || d.holderName) && (
        <p className="mt-1 text-xs text-sand-200 font-sans">
          {[d.siteLabel, d.holderName].filter(Boolean).join(" · ")}
        </p>
      )}

      <p className="mt-2 text-sm text-sand-200 font-sans">
        {d.walletNumber?.label} ·{" "}
        {d.walletNumber?.provider ? providerLabel(d.walletNumber.provider) : "—"}
      </p>
      <p className="font-mono text-xs text-sand-200 mt-1">
        {d.walletNumber?.msisdn}
        {d.simMsisdn ? ` · SIM ${d.simMsisdn}` : ""}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono text-sand-200">
        <div>App: {d.appVersionName ? `v${d.appVersionName}` : "—"}</div>
        <div>Queue: {d.pendingSmsCount}</div>
        <div>Last seen: {fmtWhen(d.lastSeenAt)}</div>
        <div>Last sync: {fmtWhen(d.lastSyncAt)}</div>
        <div>SMS perm: {d.smsPermissionOk == null ? "—" : d.smsPermissionOk ? "OK" : "missing"}</div>
        <div>Last pong: {fmtWhen(d.lastPongAt)}</div>
      </div>

      {d.updateRequired && (
        <p className="mt-2 text-xs text-amber-200 font-sans font-semibold">Update required</p>
      )}
      {d.lastError && (
        <p className="mt-2 text-xs text-clay-400 font-sans break-words">
          Error ({fmtWhen(d.lastErrorAt)}): {d.lastError}
        </p>
      )}
      {(d.syncRequested || d.wipeRequested || d.pingRequested) && (
        <p className="mt-2 text-xs text-sand-200 font-sans">
          Pending:{" "}
          {[
            d.syncRequested ? "force sync" : null,
            d.wipeRequested ? "wipe" : null,
            d.pingRequested ? "ping" : null,
          ]
            .filter(Boolean)
            .join(", ")}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs font-sans">
        <Link to={feedLink(d.walletNumberId)} className="text-veld-400 hover:underline">
          Live feed
        </Link>
        <Link to={feedLink(d.walletNumberId, "PENDING")} className="text-clay-400 hover:underline">
          Pending deposits
        </Link>
        <button type="button" className="text-sand-200 hover:underline" onClick={onToggleExpand}>
          {expanded ? "Hide details" : "Activity & audit"}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-ink-700 space-y-3 text-xs font-sans">
          <div>
            <p className="text-sand-50 font-semibold mb-1">Recent SMS / deposits</p>
            {(activity.data ?? []).length === 0 && !activity.isLoading && (
              <p className="text-sand-200">No captures yet for this wallet.</p>
            )}
            <ul className="space-y-1.5">
              {(activity.data ?? []).map((a: CaptureDeviceActivityItem) => (
                <li key={a.id} className="rounded-md bg-ink-950/80 border border-ink-800 px-2 py-1.5">
                  <div className="flex justify-between gap-2">
                    <span className="font-mono text-sand-50">{formatNad(a.amount)}</span>
                    <span className="text-sand-200">{a.matchStatus}</span>
                  </div>
                  <p className="text-sand-200 mt-0.5 truncate">
                    {(a.senderName || a.senderMsisdn || "—") +
                      (a.reference ? ` · ${a.reference}` : "")}
                  </p>
                  <p className="text-sand-200/80 mt-0.5 line-clamp-2">{a.rawMessage}</p>
                  <p className="text-sand-200/70 mt-0.5 font-mono">{fmtWhen(a.receivedAt)}</p>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-sand-50 font-semibold">Device audit</p>
                <Link
                to={`/audit?entityType=CaptureDevice&entityId=${encodeURIComponent(d.id)}`}
                className="text-veld-400 hover:underline"
              >
                Full trail
              </Link>
            </div>
            <ul className="space-y-1">
              {(audit.data ?? []).map((log: AuditLogDto) => (
                <li key={log.id} className="rounded-md bg-ink-950/80 border border-ink-800 px-2 py-1.5">
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
                <li className="text-sand-200">No device events yet.</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {isAdmin && !renaming && (
        <div className="mt-3 pt-3 border-t border-ink-700 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-ink-700 px-2 py-1 text-xs hover:bg-ink-800"
              onClick={() => {
                setRenaming(true);
                setRenameValue(d.name);
              }}
            >
              Rename
            </button>
            <button
              type="button"
              disabled={!d.hasPendingProvision || reshow.isPending}
              className="rounded-md border border-ink-700 px-2 py-1 text-xs hover:bg-ink-800 disabled:opacity-40"
              onClick={() => reshow.mutate()}
              title={
                d.hasPendingProvision
                  ? "Re-show pending provision QR"
                  : "No pending key — rotate to issue a new one"
              }
            >
              Show QR
            </button>
            <button
              type="button"
              disabled={forceSync.isPending}
              className="rounded-md border border-ink-700 px-2 py-1 text-xs hover:bg-ink-800 disabled:opacity-50"
              onClick={() => forceSync.mutate()}
            >
              Force sync
            </button>
            <button
              type="button"
              disabled={ping.isPending}
              className="rounded-md border border-ink-700 px-2 py-1 text-xs hover:bg-ink-800 disabled:opacity-50"
              onClick={() => ping.mutate()}
            >
              Test ping
            </button>
            <button
              type="button"
              className="rounded-md border border-ink-700 px-2 py-1 text-xs hover:bg-ink-800"
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
              Notes
            </button>
            <button
              type="button"
              disabled={rotate.isPending}
              className="rounded-md border border-ink-700 px-2 py-1 text-xs hover:bg-ink-800 disabled:opacity-50"
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
              className="rounded-md border border-clay-500/40 px-2 py-1 text-xs text-clay-400 hover:bg-clay-600/15 disabled:opacity-50"
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
              className="rounded-md border border-clay-500/40 px-2 py-1 text-xs text-clay-400 hover:bg-clay-600/15 disabled:opacity-50"
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

          {editingNotes && (
            <div className="grid sm:grid-cols-2 gap-2 pt-1">
              <input
                className="rounded-md bg-ink-950 border border-ink-700 px-2 py-1 text-xs"
                placeholder="Site label"
                value={notesDraft.siteLabel}
                onChange={(e) => setNotesDraft((s) => ({ ...s, siteLabel: e.target.value }))}
              />
              <input
                className="rounded-md bg-ink-950 border border-ink-700 px-2 py-1 text-xs"
                placeholder="Holder name"
                value={notesDraft.holderName}
                onChange={(e) => setNotesDraft((s) => ({ ...s, holderName: e.target.value }))}
              />
              <input
                className="rounded-md bg-ink-950 border border-ink-700 px-2 py-1 text-xs"
                placeholder="SIM MSISDN"
                value={notesDraft.simMsisdn}
                onChange={(e) => setNotesDraft((s) => ({ ...s, simMsisdn: e.target.value }))}
              />
              <textarea
                className="sm:col-span-2 rounded-md bg-ink-950 border border-ink-700 px-2 py-1 text-xs min-h-[56px]"
                placeholder="Notes"
                value={notesDraft.notes}
                onChange={(e) => setNotesDraft((s) => ({ ...s, notes: e.target.value }))}
              />
              <button
                type="button"
                disabled={saveNotes.isPending}
                className="rounded-md bg-veld-600 px-2 py-1 text-xs text-white font-semibold disabled:opacity-50"
                onClick={() => saveNotes.mutate()}
              >
                Save notes
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <select
              className="rounded-md bg-ink-950 border border-ink-700 px-2 py-1 text-xs min-w-[10rem]"
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
              className="rounded-md border border-ink-700 px-2 py-1 text-xs hover:bg-ink-800 disabled:opacity-40"
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
        </div>
      )}
    </div>
  );
}
