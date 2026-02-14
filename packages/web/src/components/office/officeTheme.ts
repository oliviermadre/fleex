/** Office color palette — warm, neutral tones with activity accents */
export const OFFICE = {
  // Exterior / void
  exterior: '#1a1d23',
  exteriorDark: '#12141a',

  // Walls
  wallTop: '#5c6370',
  wallSide: '#4b5263',
  wallCorner: '#3e4451',

  // Floors
  floorMain: '#e8dcc8',
  floorLobby: '#d4c8b0',
  floorCorridor: '#c8bca4',

  // Wood (desks, furniture)
  woodLight: '#c4956a',
  woodMid: '#a67c52',
  woodDark: '#8b6340',

  // Panel backgrounds
  panelBg: 'rgba(26, 29, 35, 0.95)',
  panelBorder: '#3e4451',
  panelBorderDim: '#2c313a',
  panelHighlight: 'rgba(255, 255, 255, 0.04)',

  // Activity status colors
  activeGreen: '#22c55e',
  activeGreenDim: '#166534',
  activeGreenGlow: 'rgba(34, 197, 94, 0.3)',

  workingBlue: '#3b82f6',
  workingBlueDim: '#1e40af',
  workingBlueGlow: 'rgba(59, 130, 246, 0.3)',

  thinkingAmber: '#f59e0b',
  thinkingAmberDim: '#92400e',
  thinkingAmberGlow: 'rgba(245, 158, 11, 0.3)',

  errorRed: '#ef4444',
  errorRedDim: '#991b1b',
  errorRedGlow: 'rgba(239, 68, 68, 0.3)',

  idleGray: '#6b7280',

  // Text
  textPrimary: '#e5e7eb',
  textSecondary: '#9ca3af',
  textMuted: '#6b7280',
  textFaint: '#4b5563',

  // Selection
  selectionBlue: '#3b82f6',
  selectionGlow: 'rgba(59, 130, 246, 0.4)',

  // Robot colors
  robotBody: '#6366f1',
  robotGlow: 'rgba(99, 102, 241, 0.4)',
  shellBody: '#8b5cf6',
  shellGlow: 'rgba(139, 92, 246, 0.3)',

  // Computer screen
  screenOn: '#a5f3fc',
  screenOff: '#374151',

  // Sign / labels
  signBg: '#fef3c7',
  signText: '#92400e',
} as const;

/** Get status color based on robot/session activity */
export function getStatusColor(activity: string): string {
  if (activity === 'working' || activity === 'executing') return OFFICE.workingBlue;
  if (activity === 'thinking') return OFFICE.thinkingAmber;
  if (activity.startsWith('waiting_')) return OFFICE.thinkingAmber;
  if (activity === 'error') return OFFICE.errorRed;
  return OFFICE.idleGray;
}

/** Get status label for display */
export function getStatusLabel(activity: string): string {
  if (activity === 'idle') return 'Idle';
  if (activity === 'working') return 'Working';
  if (activity === 'executing') return 'Executing';
  if (activity === 'waiting_tool_approval') return 'Awaiting Approval';
  if (activity === 'waiting_user_choice') return 'Awaiting Input';
  if (activity === 'waiting_plan_approval') return 'Awaiting Plan';
  if (activity.startsWith('waiting_')) return 'Waiting';
  if (activity === 'error') return 'Error';
  return activity;
}
