import { computeFleet, computeStalls } from './fleet-compute'

// Use globalThis to survive Next.js hot module replacement
const g = globalThis as {
  __mcdClients?: Set<ReadableStreamDefaultController>
  __mcdFleetInterval?: ReturnType<typeof setInterval>
};
const clients = (g.__mcdClients ??= new Set<ReadableStreamDefaultController>());

export function addClient(controller: ReadableStreamDefaultController): void {
  clients.add(controller);
  startFleetBroadcaster();
}

export function removeClient(controller: ReadableStreamDefaultController): void {
  clients.delete(controller);
  if (clients.size === 0) stopFleetBroadcaster();
}

export function broadcast(data: unknown): void {
  const chunk = `data: ${JSON.stringify(data)}\n\n`;
  for (const controller of clients) {
    try {
      controller.enqueue(chunk);
    } catch {
      clients.delete(controller);
    }
  }
}

function broadcastFleetUpdate(): void {
  const mcdDir = process.env.MCD_CHANNELS_DIR;
  if (!mcdDir || clients.size === 0) return;
  try {
    const fleet = computeFleet(mcdDir);
    broadcast({ type: 'fleet-update', data: fleet });
    const { stalls, checkedAt } = computeStalls(mcdDir);
    if (stalls.length > 0) {
      broadcast({ type: 'stall-alert', data: { stalls, checkedAt } });
    }
  } catch {
    // Non-fatal: skip this tick
  }
}

function startFleetBroadcaster(): void {
  if (g.__mcdFleetInterval != null) return;
  // Push initial state immediately, then every 5s
  broadcastFleetUpdate();
  g.__mcdFleetInterval = setInterval(broadcastFleetUpdate, 5_000);
}

function stopFleetBroadcaster(): void {
  if (g.__mcdFleetInterval != null) {
    clearInterval(g.__mcdFleetInterval);
    g.__mcdFleetInterval = undefined;
  }
}
