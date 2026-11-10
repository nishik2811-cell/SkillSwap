import nodemailer from 'nodemailer';

export const sent = []; // captured only when NODE_ENV=test
const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,   // a blocked SMTP port must not hang the request
    })
  : null;

export async function sendMail({ to, subject, text }) {
  if (process.env.NODE_ENV === 'test') return void sent.push({ to, subject, text });
  if (!transport) {
    // SMTP not configured: say so loudly instead of pretending the email was delivered.
    console.warn(`[mail] SMTP_HOST not set; email NOT sent. To: ${to}\n${subject}\n${text}`);
    return;
  }
  // Never throws: the account or reset token already exists, and the person can ask for the email again.
  try { const info = await transport.sendMail({ from: process.env.MAIL_FROM, to, subject, text }); console.log(`[mail] accepted by SMTP for ${to} (${subject}): ${info.response}`); }
  catch (e) { console.error(`[mail] FAILED to ${to} (${subject}): ${e.message}`); }
}
