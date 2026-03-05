import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import {
  getGitHubConfig,
  getGoogleConfig,
  exchangeCodeForToken,
  fetchGitHubUser,
  fetchGoogleUser,
  type OAuthProviderConfig,
} from '../auth/oauth-providers.js';

const SESSION_COOKIE = 'fleex_session';
const STATE_COOKIE = 'fleex_oauth_state';
const COOKIE_OPTS = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000'; // 30 days

function setCookie(name: string, value: string, opts = COOKIE_OPTS): string {
  return `${name}=${value}; ${opts}`;
}

export function authRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    const { userStore, sessionManager, logger } = container;

    if (!userStore || !sessionManager) {
      // No Postgres → auth not available
      app.get('/auth/status', async () => ({
        enabled: false,
        providers: [],
      }));
      return;
    }

    const githubConfig = getGitHubConfig();
    const googleConfig = getGoogleConfig();
    const providers: string[] = [];
    if (githubConfig) providers.push('github');
    if (googleConfig) providers.push('google');

    // ── Auth status ──

    app.get('/auth/status', async () => ({
      enabled: providers.length > 0,
      providers,
    }));

    // ── Current user ──

    app.get('/auth/me', async (request, reply) => {
      const sessionId = parseCookie(request.headers.cookie, SESSION_COOKIE);
      if (!sessionId) return reply.code(401).send({ error: 'Not authenticated' });

      const session = await sessionManager.get(sessionId);
      if (!session) return reply.code(401).send({ error: 'Session expired' });

      const user = await userStore.findById(session.userId);
      if (!user) return reply.code(401).send({ error: 'User not found' });

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        provider: user.provider,
      };
    });

    // ── Logout ──

    app.post('/auth/logout', async (request, reply) => {
      const sessionId = parseCookie(request.headers.cookie, SESSION_COOKIE);
      if (sessionId) {
        await sessionManager.destroy(sessionId);
      }
      reply.header('Set-Cookie', setCookie(SESSION_COOKIE, '', 'Path=/; HttpOnly; Max-Age=0'));
      return { ok: true };
    });

    // ── GitHub OAuth ──

    if (githubConfig) {
      registerOAuthFlow(app, 'github', githubConfig, fetchGitHubUser);
    }

    // ── Google OAuth ──

    if (googleConfig) {
      registerOAuthFlow(app, 'google', googleConfig, fetchGoogleUser);
    }

    // ── Generic OAuth flow registration ──

    function registerOAuthFlow(
      fastify: FastifyInstance,
      provider: string,
      config: OAuthProviderConfig,
      fetchUser: (token: string) => Promise<import('../auth/oauth-providers.js').OAuthUserInfo>,
    ) {
      // Step 1: Redirect to provider
      fastify.get(`/auth/${provider}`, async (_request, reply) => {
        const state = randomBytes(16).toString('hex');
        const params = new URLSearchParams({
          client_id: config.clientId,
          redirect_uri: config.callbackUrl,
          scope: config.scope,
          state,
          response_type: 'code',
        });

        reply.header('Set-Cookie', setCookie(STATE_COOKIE, state, 'Path=/; HttpOnly; SameSite=Lax; Max-Age=600'));
        return reply.redirect(`${config.authorizeUrl}?${params.toString()}`);
      });

      // Step 2: Handle callback
      fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
        `/auth/${provider}/callback`,
        async (request, reply) => {
          const { code, state, error } = request.query;

          if (error) {
            logger.warn('OAuth error', { provider, error });
            return reply.redirect('/?auth_error=' + encodeURIComponent(error));
          }

          if (!code || !state) {
            return reply.redirect('/?auth_error=missing_params');
          }

          // Verify state
          const savedState = parseCookie(request.headers.cookie, STATE_COOKIE);
          if (state !== savedState) {
            logger.warn('OAuth state mismatch', { provider });
            return reply.redirect('/?auth_error=state_mismatch');
          }

          try {
            // Exchange code for token
            const accessToken = await exchangeCodeForToken(config, code);

            // Fetch user info from provider
            const oauthUser = await fetchUser(accessToken);

            // Upsert user in database
            const user = await userStore!.upsertFromOAuth(oauthUser);

            // Create session
            const sessionId = await sessionManager!.create(user.id);

            // Set session cookie and redirect to app
            reply.header('Set-Cookie', setCookie(SESSION_COOKIE, sessionId));
            // Clear state cookie
            reply.header('Set-Cookie', setCookie(STATE_COOKIE, '', 'Path=/; HttpOnly; Max-Age=0'));
            return reply.redirect('/');
          } catch (err) {
            logger.error('OAuth callback failed', {
              provider,
              error: err instanceof Error ? err.message : String(err),
            });
            return reply.redirect('/?auth_error=exchange_failed');
          }
        },
      );
    }
  };
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;)\\s*${name}=([^;]*)`));
  return match ? match[1]! : null;
}
