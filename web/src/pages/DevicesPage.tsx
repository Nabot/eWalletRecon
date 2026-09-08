import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { api } from "../api/client";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { providerLabel } from "../lib/providers";

type ProvisionResult = {
  id: string;
  name: string;
  apiKey: string;
  provisionQrPayload: string;
  provision: { v: number; apiBase: string; apiKey: string };
  reason?: "created" | "rotated";
};

function feedLink(walletNumberId: string, status?: string) {
  const p = new URLSearchParams();
  p.set("walletNumberId", walletNumberId);
  if (status) p.set("status", status);
  return `/?${p.toString()}`;
}

export default function DevicesPage() {
  const { token, staff } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const isAdmin = staff?.role === "ADMIN";
  const registerRef = useRef<HTMLDivElement>(null);

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
  const [provision, setProvision] = useState<ProvisionResult | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const offline = useMemo(() => (data ?? []).filter((d) => !d.online), [data]);
  const unboundWallets = useMemo(
    () => (wallets.data ?? []).filter((w) => !w.device),
    [wallets.data]
  );
  const noUnboundWallets = (wallets.data?.length ?? 0) > 0 && unboundWallets.length === 0;

  async function showProvision(res: Omit<ProvisionResult, "reason">, reason: "created" | "rotated") {
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
    mutationFn: () => api.createDevice(token!, name.trim(), walletNumberId),
    onSuccess: async (res) => {
      setName("");
      setWalletNumberId("");
      void qc.invalidateQueries({ queryKey: ["devices"] });
      void qc.invalidateQueries({ queryKey: ["wallets"] });
      await showProvision(res, "created");
      push("Phone registered — scan the QR once on the handset", "success");
    },
    onError: (e: Error) => push(e.message, "error"),
  });

  const rename = useMutation({
    mutationFn: ({ id, nextName }: { id: string; nextName: string }) =>
      api.renameDevice(token!, id, nextName),
    onSuccess: () => {
      setRenamingId(null);
      setRenameValue("");
      void qc.invalidateQueries({ queryKey: ["devices"] });
      void qc.invalidateQueries({ queryKey: ["wallets"] });
      push("Phone renamed", "success");
    },
    onError: (e: Error) => push(e.message, "error"),
  });

  const rotate = useMutation({
    mutationFn: (id: string) => api.rotateDeviceKey(token!, id),
    onSuccess: async (res) => {
      void qc.invalidateQueries({ queryKey: ["devices"] });
      await showProvision(res, "rotated");
      push("New key issued — scan QR on the phone before closing", "success");
    },
    onError: (e: Error) => push(e.message, "error"),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeDevice(token!, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["devices"] });
      void qc.invalidateQueries({ queryKey: ["wallets"] });
      push("Phone revoked — wallet is free to rebind", "success");
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
          SMS capture handsets — health, provision QR, and wallet binding
        </p>
      </div>

      {offline.length > 0 && (
        <div className="mb-4 rounded-md border border-clay-500/40 bg-clay-600/15 px-4 py-3 text-sm font-sans">
          <p className="text-clay-400 font-semibold">
            {offline.length} phone{offline.length === 1 ? "" : "s"} offline
          </p>
          <p className="text-sand-200 mt-1">
            {offline.map((d) => d.name).join(", ")} — SMS capture may be delayed until they reconnect.
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
            Creates a key shown once. Scan the QR on the handset — connection locks after first success.
          </p>
          {noUnboundWallets ? (
            <p className="mt-3 text-sm text-sand-200 font-sans">
              All wallets have a phone. Revoke an existing phone first to free a wallet binding.
            </p>
          ) : (
            <div className="mt-3 grid sm:grid-cols-3 gap-2 font-sans text-sm">
              <label className="block sm:col-span-1">
                <span className="text-xs text-sand-200">Phone name</span>
                <input
                  className="mt-1 w-full rounded-md bg-ink-950 border border-ink-700 px-2 py-1.5"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Phone-PayPulse-2"
                />
              </label>
              <label className="block sm:col-span-1">
                <span className="text-xs text-sand-200">Wallet phone</span>
                <select
                  className="mt-1 w-full rounded-md bg-ink-950 border border-ink-700 px-2 py-1.5"
                  value={walletNumberId}
                  onChange={(e) => setWalletNumberId(e.target.value)}
                  disabled={unboundWallets.length === 0}
                >
                  <option value="">Select…</option>
                  {unboundWallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label} ({w.msisdn})
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  disabled={
                    create.isPending || !name.trim() || !walletNumberId || unboundWallets.length === 0
                  }
                  onClick={() => create.mutate()}
                  className="w-full rounded-md bg-veld-600 hover:bg-veld-500 text-white px-3 py-1.5 font-semibold disabled:opacity-50"
                >
                  {create.isPending ? "Creating…" : "Create & show QR"}
                </button>
              </div>
            </div>
          )}
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
              {provision.reason === "rotated" ? "Scan new key once" : "Provision once"}
            </h3>
            <p className="mt-1 text-sm text-clay-400 font-sans font-semibold">
              Do not close until the phone has scanned this QR (or you have copied the payload). The
              key is never shown again.
            </p>
            <p className="mt-2 text-sm text-sand-200">
              Handset: <span className="font-semibold text-sand-50">{provision.name}</span>
              {provision.reason === "rotated"
                ? " — old key stops working immediately."
                : " — lost phone = revoke, then register a new one."}
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
              Done — I scanned / saved it
            </button>
            <p className="mt-2 text-center text-[11px] text-sand-200 font-sans">
              Esc or click outside to close
            </p>
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

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {devices.map((d) => (
          <div
            key={d.id}
            className={`border rounded-lg p-4 bg-ink-900 shadow-fb ${
              d.online ? "border-ink-700" : "border-clay-500/35"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              {renamingId === d.id ? (
                <form
                  className="flex-1 flex gap-1 min-w-0"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const next = renameValue.trim();
                    if (!next || next === d.name) {
                      setRenamingId(null);
                      return;
                    }
                    rename.mutate({ id: d.id, nextName: next });
                  }}
                >
                  <input
                    autoFocus
                    className="flex-1 min-w-0 rounded-md bg-ink-950 border border-ink-700 px-2 py-1 text-sm"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setRenamingId(null);
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
                <span
                  className={`h-2 w-2 rounded-full ${d.online ? "bg-veld-400" : "bg-clay-400"}`}
                />
                {d.online ? "ONLINE" : "OFFLINE"}
              </span>
            </div>
            <p className="mt-2 text-sm text-sand-200 font-sans">
              {d.walletNumber?.label} ·{" "}
              {d.walletNumber?.provider ? providerLabel(d.walletNumber.provider) : "—"}
            </p>
            <p className="font-mono text-xs text-sand-200 mt-1">{d.walletNumber?.msisdn}</p>
            <p className="mt-3 text-xs font-mono text-sand-200">
              Last seen: {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : "never"}
            </p>

            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs font-sans">
              <Link
                to={feedLink(d.walletNumberId)}
                className="text-veld-400 hover:underline"
              >
                Live feed
              </Link>
              <Link
                to={feedLink(d.walletNumberId, "PENDING")}
                className="text-clay-400 hover:underline"
              >
                Pending deposits
              </Link>
            </div>

            {isAdmin && renamingId !== d.id && (
              <div className="mt-3 pt-3 border-t border-ink-700 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-ink-700 px-2 py-1 text-xs hover:bg-ink-800"
                  onClick={() => {
                    setRenamingId(d.id);
                    setRenameValue(d.name);
                  }}
                >
                  Rename
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
                    rotate.mutate(d.id);
                  }}
                >
                  Rotate key
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
                    revoke.mutate(d.id);
                  }}
                >
                  Revoke
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
