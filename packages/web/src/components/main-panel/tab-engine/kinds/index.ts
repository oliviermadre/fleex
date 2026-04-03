/**
 * Side-effect imports — each file registers its kind via registerTabKind().
 * To add a new tab kind, create a file here and add an import line.
 */
import './shell';
import './claude';
import './execution';
import './ticket';

// Re-export builders for convenience
export { buildShellTab } from './shell';
export { buildClaudeTab } from './claude';
export { buildExecutionTab, buildAgentTab } from './execution';
export { buildTicketTab } from './ticket';
