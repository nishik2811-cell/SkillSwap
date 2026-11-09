export class ApiError extends Error {
  constructor(status, body) { super(body?.error || `http_${status}`); this.status = status; this.body = body || {}; }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  let res;
  try {
    res = await fetch(`/api/v1${path}`, {
      method, credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: form || (body ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError(0, { error: 'network' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

const MESSAGES = {
  network: "Can't reach the server. Check your connection and try again.",
  invalid_credentials: 'Wrong email/username or password.',
  email_not_verified: 'Please verify your email first. Check your inbox for the link.',
  email_taken: 'That email already has an account.',
  username_taken: 'That ID is taken.',
  invalid_or_expired_token: 'This link is invalid or has expired.',
  unauthenticated: 'Please log in.',
  invalid_input: 'Some fields need fixing.',
  account_inactive: 'This account is not active.',
};
export const errorText = (e) => MESSAGES[e?.message] || 'Something went wrong. Please try again.';
