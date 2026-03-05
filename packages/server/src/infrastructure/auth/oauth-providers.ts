/**
 * OAuth2 provider configurations for GitHub and Google SSO.
 *
 * Environment variables:
 *   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   AUTH_CALLBACK_BASE_URL (e.g. https://fleex.example.com)
 */

export interface OAuthProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  scope: string;
}

export interface OAuthUserInfo {
  provider: string;
  providerId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

const callbackBase = () => process.env['AUTH_CALLBACK_BASE_URL'] || 'http://localhost:3000';

export function getGitHubConfig(): OAuthProviderConfig | null {
  const clientId = process.env['GITHUB_CLIENT_ID'];
  const clientSecret = process.env['GITHUB_CLIENT_SECRET'];
  if (!clientId || !clientSecret) return null;

  return {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    clientId,
    clientSecret,
    callbackUrl: `${callbackBase()}/auth/github/callback`,
    scope: 'read:user user:email',
  };
}

export function getGoogleConfig(): OAuthProviderConfig | null {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  if (!clientId || !clientSecret) return null;

  return {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    clientId,
    clientSecret,
    callbackUrl: `${callbackBase()}/auth/google/callback`,
    scope: 'openid email profile',
  };
}

export async function exchangeCodeForToken(
  config: OAuthProviderConfig,
  code: string,
): Promise<string> {
  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.callbackUrl,
      grant_type: 'authorization_code',
    }),
  });

  const data = await res.json() as Record<string, unknown>;
  const token = data.access_token as string | undefined;
  if (!token) {
    throw new Error(`OAuth token exchange failed: ${JSON.stringify(data)}`);
  }
  return token;
}

export async function fetchGitHubUser(accessToken: string): Promise<OAuthUserInfo> {
  const [userRes, emailsRes] = await Promise.all([
    fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    }),
    fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    }),
  ]);

  const user = await userRes.json() as Record<string, unknown>;
  const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;

  const primaryEmail = emails.find((e) => e.primary && e.verified)?.email
    ?? emails.find((e) => e.verified)?.email
    ?? (user.email as string);

  return {
    provider: 'github',
    providerId: String(user.id),
    email: primaryEmail,
    name: (user.name as string) ?? (user.login as string) ?? null,
    avatarUrl: (user.avatar_url as string) ?? null,
  };
}

export async function fetchGoogleUser(accessToken: string): Promise<OAuthUserInfo> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await res.json() as Record<string, unknown>;

  return {
    provider: 'google',
    providerId: String(data.id),
    email: data.email as string,
    name: (data.name as string) ?? null,
    avatarUrl: (data.picture as string) ?? null,
  };
}
