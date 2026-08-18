/**
 * Contract test: the generated surface must satisfy the API's schema rules.
 *
 * The stake is all-or-nothing. A single invalid property key makes the Messages
 * API reject the *whole* request with `tools.<n>.custom.input_schema.properties`,
 * so one odd argument name anywhere in the CLI takes down every tool at once and
 * the assistant answers nothing but a 400. That happened: `workflow show` declares
 * `<id|slug>`, which is good help text and an illegal property name.
 *
 * Nothing here is hard-coded — it walks the real command tree, so the next command
 * with an unusual argument name fails this test instead of the product.
 */
import { describe, it, expect } from 'vitest';
import { buildProgram } from '@fleex/cli/program';
import { generateTools, PROPERTY_KEY_PATTERN } from '../src/generator.ts';

/** What the API accepts as a tool name. */
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

const root = await buildProgram();
const tools = generateTools(root);

describe('generated tool schemas', () => {
  it('generates a non-trivial surface, so the assertions below mean something', () => {
    expect(tools.length).toBeGreaterThan(20);
  });

  it('gives every tool a name the API accepts', () => {
    const bad = tools.filter((t) => !TOOL_NAME_PATTERN.test(t.name)).map((t) => t.name);
    expect(bad).toEqual([]);
  });

  it('gives every input property a key the API accepts', () => {
    const bad: string[] = [];
    for (const tool of tools) {
      const properties = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      for (const key of Object.keys(properties)) {
        if (!PROPERTY_KEY_PATTERN.test(key)) bad.push(`${tool.name}.${key}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('keeps required entries pointing at properties that exist', () => {
    // A `required` naming a key that is not in `properties` is the other way this
    // request gets rejected wholesale.
    const bad: string[] = [];
    for (const tool of tools) {
      const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
      const properties = Object.keys(schema.properties ?? {});
      for (const key of schema.required ?? []) {
        if (!properties.includes(key)) bad.push(`${tool.name}.${key}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('folds a pipe in an argument name into a camel hump', () => {
    // `workflow show <id|slug>`: the CLI keeps the readable name, the tool gets a
    // legal one, and buildArgv reads the same key it published.
    const show = tools.find((t) => t.name === 'fleex_workflow_show');
    expect(show).toBeDefined();
    expect(show!.arguments.map((a) => a.key)).toContain('idSlug');
  });
});
