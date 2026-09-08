import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { formatNad } from "../api/client";
import type { RealtimeEvent } from "@ewallet/shared";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:3001/ws";

export type RealtimeState = {
  connected: boolean;
};

let listeners = new Set<(s: RealtimeState) => void>();
let sharedState: RealtimeState = { connected: false };

function setShared(next: RealtimeState) {
  sharedState = next;
  listeners.forEach((l) => l(next));
}

export function useRealtimeStatus(): RealtimeState {
  const [state, setState] = useState(sharedState);
  useEffect(() => {
    listeners.add(setState);
    setState(sharedState);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}

export function useRealtime() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const { push } = useToast();
  const pushRef = useRef(push);
  pushRef.current = push;

  useEffect(() => {
    if (!token) {
      setShared({ connected: false });
      return;
    }

    let closed = false;
    let ws: WebSocket | null = null;
    let retryTimer: number | undefined;
    let attempt = 0;

    function connect() {
      if (closed) return;
      ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token!)}`);

      ws.onopen = () => {
        attempt = 0;
        setShared({ connected: true });
      };

      ws.onclose = () => {
        setShared({ connected: false });
        if (closed) return;
        const delay = Math.min(10_000, 1000 * 2 ** attempt);
        attempt += 1;
        retryTimer = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws?.close();
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as RealtimeEvent | { type: string };
          if (msg.type === "deposit.created" || msg.type === "deposit.updated") {
            void qc.invalidateQueries({ queryKey: ["deposits"] });
            void qc.invalidateQueries({ queryKey: ["exceptions"] });
            void qc.invalidateQueries({ queryKey: ["wallet-totals"] });
            void qc.invalidateQueries({ queryKey: ["pending-count"] });
            void qc.invalidateQueries({ queryKey: ["daily-closeout"] });
            void qc.invalidateQueries({ queryKey: ["audit"] });

            if (msg.type === "deposit.created" && "payload" in msg) {
              const d = msg.payload;
              pushRef.current(
                `New deposit ${formatNad(d.amount)} · ${d.walletNumber?.label ?? d.provider}`,
                "info"
              );
            }
          }
          if (msg.type === "device.heartbeat") {
            void qc.invalidateQueries({ queryKey: ["devices"] });
          }
          if (msg.type === "audit.created") {
            void qc.invalidateQueries({ queryKey: ["audit"] });
            void qc.invalidateQueries({ queryKey: ["device-audit"] });
          }
        } catch {
          /* ignore */
        }
      };
    }

    connect();

    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      ws?.close();
      setShared({ connected: false });
    };
  }, [token, qc]);
}
