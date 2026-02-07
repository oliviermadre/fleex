import { describe, it, expect } from 'vitest';
import {
  determineClaudeActivity,
  type ActivityInput,
} from '../../src/domain/services/claude-activity-determiner.js';
import type { ClaudeMessage } from '../../src/domain/types/claude-message.js';

function makeInput(overrides: Partial<ActivityInput> = {}): ActivityInput {
  return {
    messages: [],
    fileAgeSeconds: 0,
    cpuPercent: 0,
    hasPendingToolApproval: false,
    ...overrides,
  };
}

function userMsg(): ClaudeMessage {
  return { type: 'user', message: { role: 'user', content: 'hello' } };
}

function userToolResultMsg(): ClaudeMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tool_0' }],
    },
  };
}

function assistantTextMsg(): ClaudeMessage {
  return { type: 'assistant', message: { role: 'assistant', content: 'I will help.' } };
}

function assistantWithTools(...toolNames: string[]): ClaudeMessage {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: toolNames.map((name, i) => ({
        type: 'tool_use' as const,
        name,
        id: `tool_${i}`,
      })),
    },
  };
}

function progressMsg(): ClaudeMessage {
  return { type: 'progress', message: undefined };
}

function systemMsg(): ClaudeMessage {
  return { type: 'system', message: { role: 'system', content: 'init' } };
}

describe('determineClaudeActivity', () => {
  describe('unknown state', () => {
    it('returns unknown when no messages', () => {
      expect(determineClaudeActivity(makeInput())).toBe('unknown');
    });

    it('returns unknown when only progress/system messages', () => {
      expect(
        determineClaudeActivity(makeInput({ messages: [progressMsg(), systemMsg()] })),
      ).toBe('unknown');
    });
  });

  describe('user message last (human input)', () => {
    it('returns working when file recently modified', () => {
      expect(
        determineClaudeActivity(makeInput({ messages: [userMsg()], fileAgeSeconds: 2 })),
      ).toBe('working');
    });

    it('returns working at 5s boundary', () => {
      expect(
        determineClaudeActivity(makeInput({ messages: [userMsg()], fileAgeSeconds: 5 })),
      ).toBe('working');
    });

    it('returns idle when file is stale', () => {
      expect(
        determineClaudeActivity(makeInput({ messages: [userMsg()], fileAgeSeconds: 10 })),
      ).toBe('idle');
    });
  });

  describe('user message last (tool_result — NOT human input)', () => {
    it('returns working when Claude is processing tool result', () => {
      expect(
        determineClaudeActivity(
          makeInput({
            messages: [assistantWithTools('Bash'), userToolResultMsg()],
            fileAgeSeconds: 3,
          }),
        ),
      ).toBe('working');
    });

    it('returns working within 10s window', () => {
      expect(
        determineClaudeActivity(
          makeInput({
            messages: [assistantWithTools('Read'), userToolResultMsg()],
            fileAgeSeconds: 10,
          }),
        ),
      ).toBe('working');
    });

    it('returns idle when tool result is stale (>10s)', () => {
      expect(
        determineClaudeActivity(
          makeInput({
            messages: [assistantWithTools('Bash'), userToolResultMsg()],
            fileAgeSeconds: 15,
          }),
        ),
      ).toBe('idle');
    });
  });

  describe('assistant text response (no tools)', () => {
    it('returns working when file recently modified', () => {
      expect(
        determineClaudeActivity(
          makeInput({ messages: [userMsg(), assistantTextMsg()], fileAgeSeconds: 2 }),
        ),
      ).toBe('working');
    });

    it('returns idle when file is stale', () => {
      expect(
        determineClaudeActivity(
          makeInput({ messages: [userMsg(), assistantTextMsg()], fileAgeSeconds: 10 }),
        ),
      ).toBe('idle');
    });
  });

  describe('AskUserQuestion tool', () => {
    it('returns waiting_user_choice', () => {
      expect(
        determineClaudeActivity(
          makeInput({
            messages: [userMsg(), assistantWithTools('AskUserQuestion')],
            fileAgeSeconds: 0,
          }),
        ),
      ).toBe('waiting_user_choice');
    });

    it('returns waiting_user_choice regardless of file age', () => {
      expect(
        determineClaudeActivity(
          makeInput({
            messages: [assistantWithTools('AskUserQuestion')],
            fileAgeSeconds: 300,
          }),
        ),
      ).toBe('waiting_user_choice');
    });
  });

  describe('EnterPlanMode / ExitPlanMode tool', () => {
    it('returns waiting_plan_approval for EnterPlanMode', () => {
      expect(
        determineClaudeActivity(
          makeInput({
            messages: [assistantWithTools('EnterPlanMode')],
            fileAgeSeconds: 0,
          }),
        ),
      ).toBe('waiting_plan_approval');
    });

    it('returns waiting_plan_approval for ExitPlanMode', () => {
      expect(
        determineClaudeActivity(
          makeInput({
            messages: [assistantWithTools('ExitPlanMode')],
            fileAgeSeconds: 0,
          }),
        ),
      ).toBe('waiting_plan_approval');
    });
  });

  describe('Task tool (subagents)', () => {
    it('returns waiting_tool_approval when pending approval detected', () => {
      expect(
        determineClaudeActivity(
          makeInput({
            messages: [assistantWithTools('Task')],
            fileAgeSeconds: 10,
            cpuPercent: 50,
            hasPendingToolApproval: true,
          }),
        ),
      ).toBe('waiting_tool_approval');
    });

    it('returns waiting_tool_approval when CPU low and file stale', () => {
      expect(
        determineClaudeActivity(
          makeInput({
            messages: [assistantWithTools('Task')],
            fileAgeSeconds: 10,
            cpuPercent: 0.5,
          }),
        ),
      ).toBe('waiting_tool_approval');
    });

    it('returns executing when within 10 min and CPU active', () => {
      expect(
        determineClaudeActivity(
          makeInput({
            messages: [assistantWithTools('Task')],
            fileAgeSeconds: 30,
            cpuPercent: 20,
          }),
        ),
      ).toBe('executing');
    });

    it('returns executing at 600s boundary', () => {
      expect(
        determineClaudeActivity(
          makeInput({
            messages: [assistantWithTools('Task')],
            fileAgeSeconds: 600,
            cpuPercent: 5,
          }),
        ),
      ).toBe('executing');
    });

    it('returns waiting_tool_approval after 10 min', () => {
      expect(
        determineClaudeActivity(
          makeInput({
            messages: [assistantWithTools('Task')],
            fileAgeSeconds: 601,
            cpuPercent: 5,
          }),
        ),
      ).toBe('waiting_tool_approval');
    });
  });

  describe('other tools (Bash, Read, Write, etc.)', () => {
    it('returns executing when recently modified', () => {
      expect(
        determineClaudeActivity(
          makeInput({
            messages: [assistantWithTools('Bash')],
            fileAgeSeconds: 1,
          }),
        ),
      ).toBe('executing');
    });

    it('returns executing within 30s window', () => {
      expect(
        determineClaudeActivity(
          makeInput({
            messages: [assistantWithTools('Read')],
            fileAgeSeconds: 30,
          }),
        ),
      ).toBe('executing');
    });

    it('returns waiting_tool_approval when stale (>30s)', () => {
      expect(
        determineClaudeActivity(
          makeInput({
            messages: [assistantWithTools('Write')],
            fileAgeSeconds: 31,
          }),
        ),
      ).toBe('waiting_tool_approval');
    });
  });

  describe('mixed tool blocks', () => {
    it('AskUserQuestion takes priority even with other tools', () => {
      expect(
        determineClaudeActivity(
          makeInput({
            messages: [assistantWithTools('Read', 'AskUserQuestion')],
            fileAgeSeconds: 0,
          }),
        ),
      ).toBe('waiting_user_choice');
    });

    it('EnterPlanMode takes priority over Task', () => {
      expect(
        determineClaudeActivity(
          makeInput({
            messages: [assistantWithTools('Task', 'EnterPlanMode')],
            fileAgeSeconds: 0,
          }),
        ),
      ).toBe('waiting_plan_approval');
    });
  });

  describe('progress messages are ignored', () => {
    it('skips progress and finds last meaningful message', () => {
      expect(
        determineClaudeActivity(
          makeInput({
            messages: [assistantTextMsg(), progressMsg(), progressMsg()],
            fileAgeSeconds: 10,
          }),
        ),
      ).toBe('idle');
    });
  });

  describe('assistant message with string content', () => {
    it('treats string content as no tools', () => {
      const msg: ClaudeMessage = {
        type: 'assistant',
        message: { role: 'assistant', content: 'Just text' },
      };
      expect(
        determineClaudeActivity(makeInput({ messages: [msg], fileAgeSeconds: 1 })),
      ).toBe('working');
    });
  });

  describe('tool execution flow: assistant→tool_result→assistant', () => {
    it('working when Claude processes tool results recently', () => {
      expect(
        determineClaudeActivity(
          makeInput({
            messages: [
              assistantWithTools('Bash'),
              userToolResultMsg(),
              assistantWithTools('Read'),
            ],
            fileAgeSeconds: 5,
          }),
        ),
      ).toBe('executing');
    });

    it('idle when Claude finished responding after tools', () => {
      expect(
        determineClaudeActivity(
          makeInput({
            messages: [
              assistantWithTools('Bash'),
              userToolResultMsg(),
              assistantTextMsg(),
            ],
            fileAgeSeconds: 60,
          }),
        ),
      ).toBe('idle');
    });
  });
});
