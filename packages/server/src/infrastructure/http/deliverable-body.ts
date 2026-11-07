/**
 * Body of a "create a deliverable" request, shared by the step-run route
 * (CLI/agents) and the standalone route (web UI).
 */
export interface DeliverableBody {
  title: string;
  type: string;
  content: string;
  status?: string;
  agentName?: string;
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseDeliverableBody(
  body: unknown,
  options: { allowEmptyContent?: boolean } = {},
): { ok: true; data: DeliverableBody } | { ok: false; error: string } {
  if (!isObject(body)) return { ok: false, error: 'body must be an object' };
  if (!isString(body['title']) || body['title'].trim().length === 0) {
    return { ok: false, error: 'title must be a non-empty string' };
  }
  if (!isString(body['type']) || body['type'].trim().length === 0) {
    return { ok: false, error: 'type must be a non-empty string' };
  }
  if (!isString(body['content'])) {
    return { ok: false, error: 'content must be a string' };
  }
  // On a step run, an empty deliverable is almost always a `--file` that read
  // nothing; failing there is far cheaper to diagnose than an empty artifact in
  // the run graph. A document written by hand may legitimately start empty.
  if (!options.allowEmptyContent && body['content'].length === 0) {
    return { ok: false, error: 'content must be a non-empty string' };
  }
  if (body['status'] !== undefined && body['status'] !== 'draft' && body['status'] !== 'final') {
    return { ok: false, error: 'status must be "draft" or "final"' };
  }
  if (body['agentName'] !== undefined && !isString(body['agentName'])) {
    return { ok: false, error: 'agentName must be a string' };
  }
  return {
    ok: true,
    data: {
      title: body['title'],
      type: body['type'],
      content: body['content'],
      ...(isString(body['status']) ? { status: body['status'] } : {}),
      ...(isString(body['agentName']) ? { agentName: body['agentName'] } : {}),
    },
  };
}
