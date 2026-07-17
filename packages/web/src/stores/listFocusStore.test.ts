import { describe, it, expect, beforeEach } from 'vitest';
import {
  useListFocusStore,
  DEFAULT_LIST_FOCUS_STATUSES,
  type ListFocusGroupSnapshot,
} from './listFocusStore';

const groupsA: ListFocusGroupSnapshot[] = [
  { key: 'doing', label: 'Doing', ticketIds: ['a', 'b'] },
];
const groupsB: ListFocusGroupSnapshot[] = [
  { key: 'doing', label: 'Doing', ticketIds: ['b'] },
];

describe('listFocusStore.refreeze', () => {
  beforeEach(() => {
    useListFocusStore.setState({
      selectedTicketId: null,
      inspectorFocus: null,
      frozenGroups: null,
      filters: {
        boardIds: [],
        statuses: DEFAULT_LIST_FOCUS_STATUSES,
        favoritesOnly: false,
        types: [],
        priorities: [],
        titleQuery: '',
      },
    });
  });

  it('replaces the frozen snapshot while the inspector is open (review remark 4)', () => {
    // WHY: D3 freezes the order so ↑/↓ never jump under the cursor — but that
    // must only shield against AMBIENT churn (activity/recency). A filter click
    // is user-intent: the visible list must react even with the inspector open,
    // so the view re-snapshots from the freshly-filtered live groups.
    const store = useListFocusStore.getState();
    store.open('a', groupsA);
    useListFocusStore.getState().refreeze(groupsB);
    expect(useListFocusStore.getState().frozenGroups).toEqual(groupsB);
  });

  it('is a no-op when the inspector is closed (nothing frozen to update)', () => {
    useListFocusStore.getState().refreeze(groupsB);
    expect(useListFocusStore.getState().frozenGroups).toBeNull();
  });
});
