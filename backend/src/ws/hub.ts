import type { RealtimeEvent } from "@ewallet/shared";
import type { WebSocket } from "ws";

const clients = new Set<WebSocket>();

export function addClient(ws: WebSocket) {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
}

export function broadcast(event: RealtimeEvent) {
  const data = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(data);
    }
  }
}

export function clientCount(): number {
  return clients.size;
}
