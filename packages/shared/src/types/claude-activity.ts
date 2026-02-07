export type ClaudeActivityStatus =
  | 'idle'
  | 'working'
  | 'executing'
  | 'waiting_tool_approval'
  | 'waiting_user_choice'
  | 'waiting_plan_approval'
  | 'unknown';
