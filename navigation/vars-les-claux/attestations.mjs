import { createHash, KeyObject, verify } from 'node:crypto';

// Sérialisation stable de données JSON uniquement ; jamais de clé privée ici.
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + Array.from(value, canonical).join(',') + ']';
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return '{' + Object.keys(value).filter(k => value[k] !== undefined).sort()
      .map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  throw new Error('Données de signature non JSON');
}

export function networkFingerprint(network) {
  return createHash('sha256').update(canonical({
    schemaVersion: network.schemaVersion, id: network.id, source: network.source,
    ways: network.ways, nodes: network.nodes,
    edges: network.edges.map(({ review, ...edge }) => edge),
  })).digest('hex');
}

/** Contrat de signature partagé avec un FUTUR outil de validation de confiance. */
export function attestationPayload(kind, fingerprint, edgeId, record) {
  const { signature, ...claims } = record;
  return Buffer.from(canonical({ domain: 'ouiski-routing-attestation-v1', kind, fingerprint, edgeId, claims }));
}

export function authentic(kind, fingerprint, edgeId, record, keys) {
  const signature = record?.signature;
  if (!(keys instanceof Map) || typeof signature?.keyId !== 'string'
    || typeof signature.value !== 'string') return false;
  const key = keys.get(signature.keyId);
  // Le registre est fourni par l'appelant DE CONFIANCE, jamais par network.json.
  if (!(key instanceof KeyObject) || key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') return false;
  const bytes = Buffer.from(signature.value, 'base64');
  if (bytes.length !== 64 || bytes.toString('base64') !== signature.value) return false;
  try { return verify(null, attestationPayload(kind, fingerprint, edgeId, record), key, bytes); }
  catch { return false; }
}

export function isoTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return NaN;
  const normalized = value.includes('.') ? value.replace(/\.(\d+)Z$/, (_, ms) => '.' + ms.padEnd(3, '0') + 'Z') : value.replace('Z', '.000Z');
  return new Date(time).toISOString() === normalized ? time : NaN;
}
