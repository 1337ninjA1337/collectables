/**
 * RFC 4122 v4 UUID generator.
 *
 * Chat messages use a client-generated UUID as a stable idempotency key: the
 * id is created the moment the message is composed and reused for the cloud
 * insert, the local cache, and any later offline-flush retry. The server
 * `chat_messages.id` column is `uuid`, so the id MUST be a real UUID — the
 * previous `msg-<ts>-<rand>` scheme was rejected by Postgres and offline
 * messages could never reconcile to the server.
 *
 * Prefers the platform `crypto` (Web Crypto on web, hermes/expo polyfill on
 * native). Falls back to a `Math.random` implementation only if no crypto is
 * available so the app never crashes while composing a message.
 */
export function generateUuidV4(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;

  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // Per RFC 4122 §4.4: set the version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 256; i++) {
    hex.push((i + 0x100).toString(16).slice(1));
  }

  return (
    hex[bytes[0]] +
    hex[bytes[1]] +
    hex[bytes[2]] +
    hex[bytes[3]] +
    "-" +
    hex[bytes[4]] +
    hex[bytes[5]] +
    "-" +
    hex[bytes[6]] +
    hex[bytes[7]] +
    "-" +
    hex[bytes[8]] +
    hex[bytes[9]] +
    "-" +
    hex[bytes[10]] +
    hex[bytes[11]] +
    hex[bytes[12]] +
    hex[bytes[13]] +
    hex[bytes[14]] +
    hex[bytes[15]]
  );
}

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * True when `value` is a syntactically valid RFC 4122 v4 UUID. Used to guard
 * the cloud-insert path so a legacy `msg-…` id (from pre-migration cached
 * messages) is regenerated instead of being POSTed and rejected by Postgres.
 */
export function isUuidV4(value: string): boolean {
  return UUID_V4_RE.test(value);
}
