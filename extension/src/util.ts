import * as os from 'os';
import * as crypto from 'crypto';

export function uuid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, Math.max(0, max - 1)) + '…' : s;
}

/**
 * Unbounded push queue exposed as an AsyncIterable — used as the Agent SDK
 * streaming-input `prompt`, so new user messages can be injected mid-session.
 */
export class AsyncPushQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private waiters: Array<(r: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.buffer.push(item);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined as unknown as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift() as T, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        }
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

/**
 * Non-internal IPv4 addresses, real LAN first. Virtual adapters (VirtualBox,
 * Hyper-V/WSL, VMware, Docker…) are unreachable from a phone, so they sort last
 * — the QR code encodes the first address.
 */
export function lanAddresses(): string[] {
  const entries: Array<{ address: string; name: string }> = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) entries.push({ address: iface.address, name });
    }
  }
  const isVirtual = (e: { address: string; name: string }) =>
    /virtual|vmware|vethernet|hyper-v|wsl|docker|loopback|npcap|tap|tun/i.test(e.name) ||
    e.address.startsWith('192.168.56.'); // VirtualBox host-only default range
  const score = (e: { address: string; name: string }) => {
    let s = isVirtual(e) ? 100 : 0;
    if (e.address.startsWith('192.168.')) s += 0;
    else if (e.address.startsWith('10.')) s += 1;
    else s += 2;
    return s;
  };
  return entries.sort((a, b) => score(a) - score(b)).map((e) => e.address);
}
