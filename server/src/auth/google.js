// Sign in with Google (OAuth 2.0 authorization-code flow). Only the token exchange talks to Google; tests replace google.exchange.
const origin = () => String(process.env.WEB_ORIGIN || '').replace(/\/$/, '');
export const configured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const redirectUri = () => `${origin()}/api/v1/auth/google/callback`;
export const authUrl = (state) => 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(), response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });

export const google = {
  // The id_token arrives straight from Google's token endpoint over TLS, so its payload can be trusted without a signature check.
  async exchange(code) {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri(), grant_type: 'authorization_code' }) });
    if (!r.ok) throw new Error(`token endpoint answered ${r.status}`);
    const c = JSON.parse(Buffer.from((await r.json()).id_token.split('.')[1], 'base64url').toString());
    if (c.aud !== process.env.GOOGLE_CLIENT_ID || !['accounts.google.com', 'https://accounts.google.com'].includes(c.iss) || c.exp * 1000 < Date.now()) throw new Error('unexpected id_token');
    return c;
  },
};
