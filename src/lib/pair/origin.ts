/**
 * The address a phone can use to reach this server.
 *
 * Opened on a laptop the app lives at localhost, which on a phone means the phone
 * itself. So when the request came in on a loopback name the link is rebuilt with
 * the machine's address on the local network. A deployed app already has a real
 * hostname and is used as it is; PUBLIC_ORIGIN overrides both, for a tunnel.
 */

import { networkInterfaces } from 'node:os';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

const isPrivateIPv4 = (ip: string) =>
  /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

/** The first private IPv4 address on a real interface, Wi-Fi and Ethernet first. */
export function lanAddress(): string | null {
  const preferred = /^(en|eth|wlan|wl|wi-?fi)/i;
  const found: Array<{ name: string; address: string }> = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const nic of list ?? []) {
      if (nic.family === 'IPv4' && !nic.internal && isPrivateIPv4(nic.address)) {
        found.push({ name, address: nic.address });
      }
    }
  }
  found.sort((a, b) => Number(preferred.test(b.name)) - Number(preferred.test(a.name)));
  return found[0]?.address ?? null;
}

export interface PhoneOrigin {
  origin: string;
  /** False when the link only works on this machine, so the UI can say so. */
  reachable: boolean;
}

export function phoneOrigin(req: Request): PhoneOrigin {
  const override = process.env.PUBLIC_ORIGIN?.trim().replace(/\/+$/, '');
  if (override) return { origin: override, reachable: true };

  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0] ?? new URL(req.url).protocol.replace(':', '');
  const hostname = host.replace(/:\d+$/, '');
  const port = host.match(/:(\d+)$/)?.[1];

  if (!LOOPBACK.has(hostname)) return { origin: `${proto}://${host}`, reachable: true };

  const lan = lanAddress();
  if (!lan) return { origin: `${proto}://${host}`, reachable: false };
  return { origin: `${proto}://${lan}${port ? `:${port}` : ''}`, reachable: true };
}
