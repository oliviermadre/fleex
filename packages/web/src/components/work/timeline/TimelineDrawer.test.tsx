import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { TimelineAnnotation } from '@fleex/shared';
import { useAnnotationStore } from '../../../stores/annotationStore';
import { useWorkStore } from '../../../stores/workStore';
import type { WorkTask } from '../types';
import { buildTimeline } from './buildTimeline';
import { NOW, TICKET_ID, at, fixture591 } from './timeline.fixture';
import { BAND } from './layoutAnnotations';
import { GEOMETRY } from './layoutTimeline';
import { TimelineDrawer } from './TimelineDrawer';

vi.mock('./useTicketTimeline', () => ({ useTicketTimeline: () => ({ model: buildTimeline(fixture591(), NOW) }) }));

const task = { id: TICKET_ID, number: 591, title: 'Importer', boardName: 'Fleex', status: 'doing', type: 'build' } as WorkTask;

const ann = (id: string, over: Partial<TimelineAnnotation> = {}): TimelineAnnotation => ({
  id, ticketId: TICKET_ID, at: at(9, 0), title: `Titre ${id}`, body: '', tone: 'info', sourceCommentId: null,
  authorType: 'user', authorName: 'nas', createdAt: at(9, 0), updatedAt: at(9, 0), ...over,
});

/** Drawer height (16 px padding + frieze + band budget) leaving `band` px for annotations. */
const drawerFor = (band: number) => band + 16 + GEOMETRY.height;

function setup(list: TimelineAnnotation[], band: number) {
  useAnnotationStore.setState({ byTicket: { [TICKET_ID]: list }, composer: null, load: async () => {} });
  useWorkStore.setState({ timelineHeight: drawerFor(band) });
  render(<TimelineDrawer task={task} deliverables={[]} onOpenExecution={vi.fn()} />);
}

const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const viewer = () => screen.queryByTestId('annotation-viewer');
/** A real click: the popover listens to mousedown, the pill to click. */
const click = (el: Element) => {
  fireEvent.mouseDown(el);
  fireEvent.click(el);
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Ticket ae288d: a pill shows only an icon — hovering it must show the annotation, clicking keeps it.
describe('TimelineDrawer — mini pills: hover shows, click pins', () => {
  it('hovering a pill opens its reader, leaving it closes it again', () => {
    setup([ann('a')], BAND.oneRow - 1);
    const pill = screen.getByTestId('annotation-pill');
    fireEvent.mouseEnter(pill);
    wait(200);
    expect(viewer()).not.toBeNull();
    fireEvent.mouseLeave(pill);
    wait(300);
    expect(viewer()).toBeNull();
  });

  it('the cursor can travel from the pill into the reader without it closing', () => {
    setup([ann('a')], BAND.oneRow - 1);
    const pill = screen.getByTestId('annotation-pill');
    fireEvent.mouseEnter(pill);
    wait(200);
    fireEvent.mouseLeave(pill);
    fireEvent.mouseEnter(screen.getByRole('dialog'));
    wait(500);
    expect(viewer()).not.toBeNull();
  });

  it('a click pins the hovered reader; a second click on the pill unpins and closes it', () => {
    setup([ann('a')], BAND.oneRow - 1);
    const pill = screen.getByTestId('annotation-pill');
    fireEvent.mouseEnter(pill);
    wait(200);
    click(pill);
    wait(10);
    fireEvent.mouseLeave(pill);
    wait(500);
    expect(viewer()).not.toBeNull();
    click(pill);
    wait(10);
    expect(viewer()).toBeNull();
  });

  it('a failed annotation does not open on hover (its click opens the retry composer)', () => {
    setup([{ ...ann('a'), uiState: 'error' } as TimelineAnnotation], BAND.oneRow - 1);
    fireEvent.mouseEnter(screen.getByTestId('annotation-pill'));
    wait(500);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('TimelineDrawer — cards', () => {
  it('clicking an open card again closes its reader instead of reopening it', () => {
    setup([ann('a')], BAND.twoRows);
    const card = screen.getByTestId('annotation-card');
    click(card);
    wait(10);
    expect(viewer()).not.toBeNull();
    click(card);
    wait(10);
    expect(viewer()).toBeNull();
  });
});
