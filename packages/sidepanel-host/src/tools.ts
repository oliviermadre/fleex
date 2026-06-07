/**
 * Bridges the generated fleex tool surface to the Anthropic Messages API.
 *
 * The JSON Schema produced by @fleex/mcp maps directly onto an Anthropic tool
 * definition's `input_schema`, so no re-derivation is needed.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { GeneratedTool } from '@fleex/mcp';

export function toAnthropicTools(tools: GeneratedTool[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as unknown as Anthropic.Tool.InputSchema,
  }));
}

/** Index tools by name for O(1) lookup during the tool-use loop. */
export function indexTools(tools: GeneratedTool[]): Map<string, GeneratedTool> {
  return new Map(tools.map((t) => [t.name, t]));
}
