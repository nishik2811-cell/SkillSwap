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

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// One branded layout for every account email: HTML for mail apps, plain text as the fallback (and for tests).
export function actionMail({ name, heading, intro, steps = [], button, link, note }) {
  const hi = name ? `Hi ${name.split(' ')[0]},` : 'Hi,';
  const text = `${hi}\n\n${intro}\n\n${steps.length ? `Getting started:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n` : ''}${button}:\n${link}\n\n${note}\n\n— The SkillSwap team`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2430">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#4f46e5;padding:20px 28px;color:#ffffff;font-size:20px;font-weight:700">SkillSwap</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:20px">${esc(heading)}</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.6">${esc(hi)}</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6">${esc(intro)}</p>
${steps.length ? `<ol style="margin:0 0 24px;padding-left:20px;font-size:15px;line-height:1.7">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
<p style="margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:8px">${esc(button)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#5b6270;line-height:1.5">Button not working? Paste this link into your browser:</p>
<p style="margin:0 0 24px;font-size:12px;color:#5b6270;word-break:break-all">${esc(link)}</p>
<p style="margin:0;font-size:13px;color:#5b6270;line-height:1.5">${esc(note)}</p>
</td></tr>
<tr><td style="padding:16px 28px;background:#f4f5f7;font-size:12px;color:#8a909c">You received this because someone used this address on SkillSwap. This is an automated message; please don't reply.</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

export async function sendMail({ to, subject, text, html }) {
  if (process.env.NODE_ENV === 'test') return void sent.push({ to, subject, text, html });
  if (!transport) {
    // SMTP not configured: say so loudly instead of pretending the email was delivered.
    console.warn(`[mail] SMTP_HOST not set; email NOT sent. To: ${to}\n${subject}\n${text}`);
    return;
  }
  // Never throws: the account or reset token already exists, and the person can ask for the email again.
  try { const info = await transport.sendMail({ from: process.env.MAIL_FROM, to, subject, text, html }); console.log(`[mail] accepted by SMTP for ${to} (${subject}): ${info.response}`); }
  catch (e) { console.error(`[mail] FAILED to ${to} (${subject}): ${e.message}`); }
}
