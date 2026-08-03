/**
 * Cookie construction for the auth flow.
 *
 * `Secure` is conditional rather than unconditional: Safari refuses `Secure`
 * cookies on `http://localhost`, which is the nominal local path. We derive it
 * from the scheme the browser actually used, with an explicit override.
 */

export interface SecureRequestLike {
  headers: Record<string, string | string[] | undefined>;
  protocol?: string;
}

/** True when the request reached the browser over HTTPS. */
export function isSecureRequest(req: SecureRequestLike): boolean {
  const override = process.env['FLEEX_COOKIE_SECURE'];
  if (override === '1') return true;
  if (override === '0') return false;

  const raw = req.headers['x-forwarded-proto'];
  const xfp = String(Array.isArray(raw) ? raw[0] : (raw ?? ''))
    .split(',')[0]
    ?.trim()
    .toLowerCase();
  if (xfp === 'https') return true;

  return req.protocol === 'https';
}

export interface CookieOptions {
  maxAge: number;
  sameSite: 'Strict' | 'Lax';
  secure: boolean;
  path?: string;
}

export function buildCookie(name: string, value: string, opts: CookieOptions): string {
  const parts = [
    `${name}=${value}`,
    `Path=${opts.path ?? '/'}`,
    'HttpOnly',
    `SameSite=${opts.sameSite}`,
  ];
  if (opts.secure) parts.push('Secure');
  parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join('; ');
}
