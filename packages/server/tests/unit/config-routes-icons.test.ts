import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { configRoutes } from '../../src/infrastructure/http/config.routes.js';
import type { Container } from '../../src/infrastructure/container.js';

describe('PUT /api/config', () => {
  it('sanitises action SVG icons server-side, so a client that skips the picker cannot store script', async () => {
    let stored: Record<string, unknown> = {};
    const container = {
      config: { get: () => stored, update: vi.fn(async (patch: Record<string, unknown>) => { stored = { ...stored, ...patch }; }) },
      pinnedStatus: { configure: vi.fn() },
    } as unknown as Container;
    const app = Fastify();
    await app.register(configRoutes(container));

    const evil = '<svg viewBox="0 0 24 24"><script>alert(1)</script><path d="M1 1h2" onclick="alert(1)"/></svg>';
    const icon = { id: 'x', icon: evil, iconType: 'svg', label: 'x', actionType: 'shell', actionValue: 'true' };
    const res = await app.inject({ method: 'PUT', url: '/api/config', payload: { pinnedIcons: [icon], workspaceActions: [icon] } });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { pinnedIcons: { icon: string }[]; workspaceActions: { icon: string }[] };
    for (const saved of [body.pinnedIcons[0]!, body.workspaceActions[0]!]) {
      expect(saved.icon).not.toMatch(/script|onclick|alert/);
      expect(saved.icon).toContain('<path d="M1 1h2"/>');
    }
  });
});
