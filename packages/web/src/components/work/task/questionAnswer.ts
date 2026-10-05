import type { AgentQuestion } from '@fleex/shared';

/**
 * The comment posted when the human answers an agent's declared questions —
 * the same thing typing it would do. One question → the bare option (what the
 * agent asked for); several → one "**prompt** option" line each, so the agent
 * can tell which answer goes with which question.
 */
export function formatQuestionAnswer(questions: AgentQuestion[], picks: string[]): string {
  if (questions.length === 1) return picks[0] ?? '';
  return questions.map((q, i) => `**${q.prompt}** ${picks[i] ?? ''}`).join('\n');
}
