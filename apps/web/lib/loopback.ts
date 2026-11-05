const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** True for 127.0.0.0/8, ::1 and localhost. Accepts a bare host, not host:port. */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return loopbackHosts.has(normalized) || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

/** The host part of a Host header value: `127.0.0.1:3007` -> `127.0.0.1`, `[::1]:3007` -> `[::1]`. */
export function hostFromHostHeader(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end === -1 ? trimmed : trimmed.slice(0, end + 1);
  }
  const colon = trimmed.lastIndexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}
