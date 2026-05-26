import type { McEvent } from './mission-control-types';

export function emitEvent(e: McEvent): void {
  const MC_URL = process.env.MISSION_CONTROL_URL;
  if (!MC_URL) return;
  const MC_SECRET = process.env.MISSION_CONTROL_SECRET;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);

  fetch(MC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(MC_SECRET ? { 'Authorization': `Bearer ${MC_SECRET}` } : {}),
    },
    body: JSON.stringify(e),
    signal: ctrl.signal,
  })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[mission-control] warn: ${msg}`);
    })
    .finally(() => clearTimeout(timer));
}

export function buildEmitter(
  instanceId: string,
  host: string,
  user: string,
): (type: McEvent['type'], payload: Record<string, unknown>) => void {
  return (type, payload) => {
    emitEvent({
      instance_id: instanceId,
      host,
      user,
      ts: new Date().toISOString(),
      type,
      payload,
    });
  };
}
