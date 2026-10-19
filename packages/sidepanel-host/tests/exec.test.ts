import { describe, it, expect } from 'vitest';
import type { GeneratedTool } from '@fleex/mcp';
import { createExec } from '../src/anthropic.ts';

const tool: GeneratedTool = {
  name: 'fleex_ticket_list',
  commandPath: ['ticket', 'list'],
  description: 'List tickets',
  inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  mutating: false,
  workspaceAware: false,
  arguments: [],
  options: [],
};

// The side panel's assistant only sees this text: it must say why the call
// failed, same as the MCP bridge, never a bare exit code.
describe('createExec failure text', () => {
  it('names the command and the reason when the binary cannot start', async () => {
    const res = await createExec({ bin: '/nonexistent/fleex' })(tool, {});
    expect(res).toEqual({ ok: false, text: 'fleex ticket list failed: could not start /nonexistent/fleex: ENOENT' });
  });

  it('keeps both streams and the real exit code', async () => {
    const res = await createExec({
      bin: process.execPath,
      prefixArgs: ['-e', 'console.log("partial"); console.error("Error: boom"); process.exit(2)', '--'],
    })(tool, {});
    expect(res.text).toBe('fleex ticket list failed: exited with code 2\npartial\nstderr:\nError: boom');
  });
});
