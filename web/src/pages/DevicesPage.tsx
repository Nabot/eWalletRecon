import { useEffect, useMemo, useState } from "react";
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
};

export default function DevicesPage() {
  const { token, staff } = useAuth();
  const { push } = useToast();
  const qc = useQueryClient();
  const isAdmin = staff?.role === "ADMIN";

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

  const offline = useMemo(() => (data ?? []).filter((d) => !d.online), [data]);

  const create = useMutation({
    mutationFn: () => api.createDevice(token!, name.trim(), walletNumberId),
    onSuccess: async (res) => {
      setProvision(res);
      setName("");
      setWalletNumberId("");
      void qc.invalidateQueries({ queryKey: ["devices"] });
      void qc.invalidateQueries({ queryKey: ["wallets"] });
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
      push("Device created — show QR once on the phone", "success");
    },
    onError: (e: Error) => push(e.message, "error"),
  });

  useEffect(() => {
    if (!provision) setQrDataUrl(null);
  }, [provision]);

  const unboundWallets = useMemo(
    () => (wallets.data ?? []).filter((w) => !w.device),
    [wallets.data]
  );

  return (
    <div>
      <div className="mb-6">
        <h2 className="font-sans font-semibold tracking-tight text-3xl text-sand-50">Capture devices</h2>
        <p className="text-sand-200 font-sans mt-1">
          Phone health and one-time provision QR (scan in the Android app)
        </p>
      </div>

      {offline.length > 0 && (
        <div className="mb-4 rounded-md border border-clay-500/40 bg-clay-600/15 px-4 py-3 text-sm font-sans">
          <p className="text-clay-400 font-semibold">
            {offline.length} device{offline.length === 1 ? "" : "s"} offline
          </p>
          <p className="text-sand-200 mt-1">
            {offline.map((d) => d.name).join(", ")} — SMS capture may be delayed until they reconnect.
          </p>
        </div>
      )}

      {isAdmin && (
        <div className="mb-6 border border-ink-700 rounded-lg p-4 bg-ink-900 shadow-fb">
          <h3 className="font-sans font-semibold text-sand-50">Register device</h3>
          <p className="text-sm text-sand-200 mt-1">
            Creates a key shown once. Scan the QR on the handset — connection locks after first success.
          </p>
          <div className="mt-3 grid sm:grid-cols-3 gap-2 font-sans text-sm">
            <label className="block sm:col-span-1">
              <span className="text-xs text-sand-200">Device name</span>
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
              >
                <option value="">Select…</option>
                {(unboundWallets.length ? unboundWallets : wallets.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label} ({w.msisdn})
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="button"
                disabled={create.isPending || !name.trim() || !walletNumberId}
                onClick={() => create.mutate()}
                className="w-full rounded-md bg-veld-600 hover:bg-veld-500 text-white px-3 py-1.5 font-semibold disabled:opacity-50"
              >
                {create.isPending ? "Creating…" : "Create & show QR"}
              </button>
            </div>
          </div>
        </div>
      )}

      {provision && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-lg rounded-lg border border-ink-700 bg-ink-900 p-5 shadow-fb-md"
          >
            <h3 className="font-sans text-xl font-semibold text-sand-50">Provision once</h3>
            <p className="mt-1 text-sm text-sand-200">
              Scan on <span className="font-semibold text-sand-50">{provision.name}</span>. This key is not
              shown again — lost phone = create a new device.
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-4 items-center">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Device provision QR"
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
              Done — I saved / scanned it
            </button>
          </div>
        </div>
      )}

      {isLoading && !data && <p className="text-sand-200">Loading…</p>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {(data ?? []).map((d) => (
          <div
            key={d.id}
            className={`border rounded-lg p-4 bg-ink-900 shadow-fb ${
              d.online ? "border-ink-700" : "border-clay-500/35"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-sans font-semibold text-sand-50">{d.name}</h3>
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-mono ${
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
          </div>
        ))}
        {data?.length === 0 && (
          <p className="text-sand-200 font-sans col-span-full">No devices registered</p>
        )}
      </div>
    </div>
  );
}
