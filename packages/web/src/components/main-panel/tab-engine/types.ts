import type { ComponentType } from 'react';

// ——— Core tab abstractions (kind-agnostic) ———

export interface TabCapabilities {
  closable: boolean;
  renamable: boolean;
  orderable: boolean;
}

/**
 * Describes a single tab in the tab bar.
 * `kind` maps to a registered TabKindDefinition — the core engine never switches on it.
 * `meta` is a kind-specific data bag; only the kind's own components read from it.
 */
export interface TabDescriptor {
  /** Unique key, e.g. "s:{id}", "c:{id}", "e:{id}" */
  key: string;
  /** Kind identifier — looked up in the tab kind registry */
  kind: string;
  /** Display label shown in the tab bar */
  label: string;
  /** What actions the tab bar allows on this tab */
  capabilities: TabCapabilities;
  /** Kind-specific payload (sessionId, executionId, status, etc.) */
  meta: Record<string, unknown>;
}

// ——— Tab kind plugin interface ———

export interface TabIconProps {
  tab: TabDescriptor;
}

export interface TabContentProps {
  tab: TabDescriptor;
}

export interface TabStatusProps {
  tab: TabDescriptor;
}

/**
 * Defines how a tab kind renders and behaves.
 *
 * To add a new tab type:
 *   1. Create a file in `tab-engine/kinds/`
 *   2. Implement `TabKindDefinition`
 *   3. Call `registerTabKind(kind, definition)` at module scope
 *   4. Add a side-effect import in `kinds/index.ts`
 *   5. Write a builder function that creates `TabDescriptor` instances
 *
 * No existing code needs to change.
 */
export interface TabKindDefinition {
  /** Component rendered as the tab icon in the tab bar */
  Icon: ComponentType<TabIconProps>;
  /** Component rendered in the main content area when this tab is active */
  Content: ComponentType<TabContentProps>;
  /** Optional status indicator in the tab bar (replaces default behavior) */
  StatusIndicator?: ComponentType<TabStatusProps>;
  /** Default capabilities for tabs of this kind */
  defaultCapabilities: TabCapabilities;
  /** Called when the user closes a tab of this kind (only if capabilities.closable) */
  onClose?: (tab: TabDescriptor) => Promise<void>;
  /** Called when the user commits an inline rename (only if capabilities.renamable) */
  onRename?: (tab: TabDescriptor, newName: string) => Promise<void>;
}
