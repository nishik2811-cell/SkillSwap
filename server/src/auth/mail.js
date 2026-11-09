import nodemailer from 'nodemailer';

export const sent = []; // captured only when NODE_ENV=test
const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null;

export async function sendMail({ to, subject, text }) {
  if (process.env.NODE_ENV === 'test') return void sent.push({ to, subject, text });
  if (!transport) {
    // SMTP not configured: say so loudly instead of pretending the email was delivered.
    console.warn(`[mail] SMTP_HOST not set; email NOT sent. To: ${to}\n${subject}\n${text}`);
    return;
  }
  await transport.sendMail({ from: process.env.MAIL_FROM, to, subject, text });
}
