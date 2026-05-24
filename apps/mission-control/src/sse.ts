// Use globalThis to survive Next.js hot module replacement
const g = globalThis as { __mcdClients?: Set<ReadableStreamDefaultController> };
const clients = (g.__mcdClients ??= new Set<ReadableStreamDefaultController>());

export function addClient(controller: ReadableStreamDefaultController): void {
  clients.add(controller);
}

export function removeClient(controller: ReadableStreamDefaultController): void {
  clients.delete(controller);
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
