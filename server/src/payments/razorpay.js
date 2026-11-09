// Thin Razorpay REST client + signature checks. Credentials are read lazily from the environment.
// Nothing here ever fakes success: without keys every call throws NOT_CONFIGURED.
import { createHmac, timingSafeEqual } from 'node:crypto';

const BASE = 'https://api.razorpay.com/v1';
export const configured = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
export const webhookConfigured = () => !!process.env.RAZORPAY_WEBHOOK_SECRET;
export const publicKeyId = () => process.env.RAZORPAY_KEY_ID || null; // the key id is public by design; the secret never leaves the server

export class GatewayError extends Error {
  constructor(message, { status, code } = {}) { super(message); this.name = 'GatewayError'; this.status = status; this.code = code; }
}

async function defaultTransport({ method, url, headers, body }) {
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
let transport = defaultTransport;
export const setTransport = (fn) => { transport = fn || defaultTransport; }; // tests inject a fake gateway; signatures stay real

async function call(method, path, body) {
  if (!configured()) throw new GatewayError('Razorpay is not configured', { code: 'NOT_CONFIGURED' });
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  let r;
  try { r = await transport({ method, url: BASE + path, headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' }, body }); }
  catch (e) { throw new GatewayError(`Gateway unreachable: ${e.message}`, { code: 'NETWORK' }); }
  if (r.status >= 400) throw new GatewayError(r.json?.error?.description || `Gateway error ${r.status}`, { status: r.status, code: r.json?.error?.code });
  return r.json;
}

export const createOrder = ({ amountPaise, receipt, notes }) => call('POST', '/orders', { amount: amountPaise, currency: 'INR', receipt, notes });
export const fetchPayment = (id) => call('GET', `/payments/${encodeURIComponent(id)}`);
export const capturePayment = (id, amountPaise) => call('POST', `/payments/${encodeURIComponent(id)}/capture`, { amount: amountPaise, currency: 'INR' });
export const refundPayment = (id, amountPaise, notes) => call('POST', `/payments/${encodeURIComponent(id)}/refund`, { amount: amountPaise, speed: 'normal', notes });

/** Look for a refund we may already have created (a response can be lost after the gateway accepted the request). */
export async function findRefund(paymentId, ourRefundRowId) {
  const r = await call('GET', `/payments/${encodeURIComponent(paymentId)}/refunds?count=100`);
  return (r.items || []).find((it) => String(it.notes?.refund_row) === String(ourRefundRowId)) || null;
}

const hmac = (secret, data) => createHmac('sha256', secret).update(data).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

/** Checkout callback proof: HMAC_SHA256(order_id + "|" + payment_id, key_secret) */
export const verifyCheckoutSignature = ({ orderId, paymentId, signature }) =>
  configured() && !!signature && safeEq(hmac(process.env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`), signature);

/** Webhook proof: HMAC_SHA256(raw request body, webhook_secret) */
export const verifyWebhookSignature = (rawBody, signature) =>
  webhookConfigured() && !!signature && safeEq(hmac(process.env.RAZORPAY_WEBHOOK_SECRET, rawBody), signature);

export const _sign = { checkout: (o, p, secret) => hmac(secret, `${o}|${p}`), webhook: (raw, secret) => hmac(secret, raw) }; // for tests
