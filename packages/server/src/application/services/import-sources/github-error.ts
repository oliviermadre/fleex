import type { ImportSourceId } from '@fleex/shared';
import { ImportError } from '../../../domain/errors.js';

/**
 * Map a failure from a `gh` GraphQL call (thrown by the exec fn or by our own
 * "not found" guards) to an {@link ImportError} with the right code:
 * - a missing/inaccessible node → IMPORT_NOT_FOUND (422),
 * - an unauthenticated `gh` → IMPORT_SOURCE_UNAVAILABLE (422),
 * - anything else (timeout, rate limit) → IMPORT_UPSTREAM_FAILED (502).
 */
export function mapGitHubError(err: unknown, sourceId: ImportSourceId): ImportError {
  const message = err instanceof Error ? err.message : String(err);

  if (/gh auth|not logged in|authentication|HTTP 401|HTTP 403|Bad credentials/i.test(message)) {
    return new ImportError(
      'GitHub CLI is not authenticated. Run `gh auth login` and retry.',
      'IMPORT_SOURCE_UNAVAILABLE',
      sourceId,
    );
  }

  if (/could not resolve|resolve to|not found|404|no such|invalid github repository/i.test(message)) {
    return new ImportError(
      'The GitHub issue or pull request could not be found or is not accessible.',
      'IMPORT_NOT_FOUND',
      sourceId,
    );
  }

  return new ImportError(`GitHub request failed: ${message}`, 'IMPORT_UPSTREAM_FAILED', sourceId);
}
