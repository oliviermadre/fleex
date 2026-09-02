import type { ContextInjectionItem, ExecutionContextData } from '@fleex/shared';
import type { PromptContentBlock } from './resolve-file-references.js';

/** A manifest entry minus the sizes, which the composer measures itself. */
export type InjectionDescriptor = Omit<ContextInjectionItem, 'charCount' | 'imageCount'>;

/**
 * Accumulates a user prompt and, in the same pass, the manifest describing what
 * went into it.
 *
 * Prompt composition used to be a bare `blocks.push()` loop, which made the
 * result impossible to audit: the Execution Log could report how many characters
 * were sent but never which deliverable or summary they were. Building both
 * artefacts here keeps them structurally in sync — a section cannot be injected
 * without being declared, because the same call does both.
 *
 * `scaffold()` is for text the agent always gets (headings, task instructions):
 * it lands in the prompt without a manifest entry, since there is no source to
 * open. `track()` is for content that came from somewhere — its descriptor
 * carries the provenance and the ids the UI needs to link back.
 */
export class PromptComposer {
  private readonly blocks: PromptContentBlock[] = [];
  private readonly manifest: ContextInjectionItem[] = [];

  /**
   * @param resolveText Expands `/api/files/...` references into image blocks.
   *                    Injected rather than imported so the composer stays a
   *                    pure accumulator, testable without file stores.
   */
  constructor(
    private readonly resolveText: (text: string) => Promise<PromptContentBlock[]>,
  ) {}

  /** Prompt text with no source behind it: headings, separators, instructions. */
  scaffold(text: string): void {
    this.blocks.push({ type: 'text', text });
  }

  /** Prompt text that came from an identifiable source, recorded in the manifest. */
  track(descriptor: InjectionDescriptor, text: string): void {
    this.blocks.push({ type: 'text', text });
    this.manifest.push({ ...descriptor, charCount: text.length });
  }

  /**
   * Same as `track()`, but resolves file references first so image attachments
   * become native blocks. The manifest entry counts them, which is the only
   * place the prompt's images are attributed to the item that carried them.
   */
  async trackResolved(descriptor: InjectionDescriptor, text: string): Promise<void> {
    const resolved = await this.resolveText(text);
    this.blocks.push(...resolved);
    const charCount = resolved.reduce((n, b) => n + (b.type === 'text' ? b.text.length : 0), 0);
    const imageCount = resolved.filter((b) => b.type === 'image').length;
    this.manifest.push({ ...descriptor, charCount, ...(imageCount > 0 ? { imageCount } : {}) });
  }

  getBlocks(): PromptContentBlock[] {
    return this.blocks;
  }

  getManifest(): ContextInjectionItem[] {
    return this.manifest;
  }
}

/** Total length of the text blocks in a prompt, ignoring image blocks. */
export function promptTextLength(blocks: PromptContentBlock[]): number {
  return blocks.reduce((n, b) => n + (b.type === 'text' ? b.text.length : 0), 0);
}

/**
 * Flatten a prompt into the exact string the SDK receives, so the raw view shows
 * what was sent rather than a reconstruction. Image blocks have no text of their
 * own; they are marked inline so their position in the prompt stays visible.
 */
export function flattenPrompt(blocks: PromptContentBlock[]): string {
  return blocks
    .map((b) => (b.type === 'text' ? b.text : '\n[image attachment]\n'))
    .join('');
}

export interface BuildExecutionContextArgs {
  executionId: string;
  systemPrompt: string;
  promptBlocks: PromptContentBlock[];
  manifest: ContextInjectionItem[];
  model: string;
  effectiveMode?: string;
  maxTurns?: number;
  memoryEngine?: 'legacy' | 'semantic';
  /** What the other engine would have injected, in shadow mode. */
  shadowManifest?: ContextInjectionItem[];
}

/**
 * Single source of truth for the `execution_context` payload, so every
 * execution kind — persona mention, skill, workflow step — reports its context
 * identically. Mirrors `buildExecutionStartData`'s role for the header.
 */
export function buildExecutionContextData(args: BuildExecutionContextArgs): ExecutionContextData {
  return {
    executionId: args.executionId,
    systemPromptRaw: args.systemPrompt,
    userPromptRaw: flattenPrompt(args.promptBlocks),
    manifest: args.manifest,
    imageCount: args.promptBlocks.filter((b) => b.type === 'image').length,
    memoryEngine: args.memoryEngine,
    ...(args.shadowManifest?.length ? { shadowManifest: args.shadowManifest } : {}),
    model: args.model,
    effectiveMode: args.effectiveMode,
    maxTurns: args.maxTurns,
  };
}
