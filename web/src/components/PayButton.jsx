import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert } from './UI.jsx';
import { rupees, usePayConfig, feesFor } from '../lib.js';

let scriptPromise;
const loadCheckout = () => scriptPromise ||= new Promise((resolve, reject) => {
  if (window.Razorpay) return resolve();
  const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.async = true;
  s.onload = resolve; s.onerror = () => { scriptPromise = null; reject(new Error('checkout_script')); };
  document.head.appendChild(s);
});

const TEXT = {
  payments_not_configured: "Online payments aren't switched on for this server yet. Your seat stays reserved; please try again later.",
  checkout_script: "Couldn't load the secure payment window. Check your connection and try again.",
  not_payable: 'This session can no longer be paid for.', not_awaiting_payment: 'This booking is not waiting for payment.',
  invalid_signature: "We couldn't verify that payment. If money was taken it will be refunded automatically.",
  payment_failed: 'The payment failed. You have not been charged; please try again.',
  amount_mismatch: "The amount paid didn't match the price, so the booking was not confirmed. Contact support if you were charged.",
  gateway_error: 'The payment provider is not responding. Please try again in a moment.',
};
const msg = (e) => TEXT[e.message] || errorText(e);

/** Starts checkout for a booking that is waiting for payment. Access is granted by the SERVER after it
 *  verifies the payment with the gateway; this component only opens the payment window and reports back. */
export default function PayButton({ bookingId, title, amountPaise, onPaid }) {
  const cfg = usePayConfig(); const f = cfg && feesFor(amountPaise, cfg); // shown up front; the server computes the real total
  const { user } = useAuth(); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [info, setInfo] = useState('');
  async function pay() {
    setErr(''); setInfo(''); setBusy(true);
    try {
      const o = await api(`/bookings/${bookingId}/pay`, { method: 'POST', body: {} });
      await loadCheckout();
      const rzp = new window.Razorpay({
        key: o.keyId, order_id: o.orderId, amount: o.amountPaise, currency: o.currency, name: 'SkillSwap', description: o.title || title,
        prefill: { name: user.fullName, email: user.email }, theme: { color: '#e8452c' },
        handler: async (r) => {
          try { await api('/payments/verify', { method: 'POST', body: { razorpay_order_id: r.razorpay_order_id, razorpay_payment_id: r.razorpay_payment_id, razorpay_signature: r.razorpay_signature } }); onPaid(); }
          catch (x) {
            if (x.message === 'payment_pending') setInfo("Your payment is being processed. We'll confirm your booking as soon as the bank responds.");
            else setErr(msg(x));
          } finally { setBusy(false); }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.on('payment.failed', (e) => { setErr(e.error?.description || TEXT.payment_failed); setBusy(false); });
      rzp.open();
    } catch (x) { setErr(msg(x)); setBusy(false); }
  }
  return <div className="stack" style={{ gap: 10 }}>
    <Alert>{err}</Alert><Alert kind="ok">{info}</Alert>
    <div><button className="btn accent pay-btn" disabled={busy} onClick={pay}>{busy ? 'Opening secure payment…' : `Pay ${rupees(f ? f.total : amountPaise)}`}</button></div>
    {f && <p className="hint" style={{ margin: 0 }}>{rupees(amountPaise)} session + {rupees(f.fee)} platform fee + {rupees(f.gst)} GST ({cfg.gstPercent}% on the fee)</p>}
    <p className="hint pay-note"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
      Secure checkout by Razorpay. SkillSwap never sees or stores your card details. <Link to="/refunds">Refund policy</Link></p>
  </div>;
}
