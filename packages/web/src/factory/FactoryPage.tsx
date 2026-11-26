import { arrivalOf, portDrop } from './teleport';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { useTicketStore } from '../stores/ticketStore';
import { useAgentPersonaStore } from '../stores/agentPersonaStore';
import { useSkillStore } from '../stores/skillStore';
import { usePanelStore } from '../stores/panelStore';
import { openTicketInWork } from '../components/work/openInWork';
import { toast, useToastOffset, useToastSkin } from '../lib/toast';
import { cn } from '../lib/cn';
import { tint } from '../lib/tints';
import { useFactoryStore } from './factoryStore';
import { watchFactory } from './factoryLive';
import { stationModel } from './stationModel';
import { FactoryMachinePopup } from './FactoryMachinePopup';
import { FactoryBuildFrame } from './FactoryBuildFrame';
import { HUD } from './hudShape';
import { FactoryHudShadow } from './FactoryHudShadow';
import { useFactorySkin } from './useFactorySkin';
import { FactoryFloorPopup } from './FactoryFloorPopup';
import { FactoryLimitsPopup } from './FactoryLimits';
import { FactoryConsole } from './FactoryConsole';
import { factoryMenu } from './factoryMenu';
import { byKey, menuAt, type Command } from './menu';
import { slotOfCode } from './keys';
import { FactoryView, type DragState, type Ghost, type ViewState } from './renderer';
import { MAX_STEP_S, frameGap } from './frameRate';
import { armFacing, canPaste, canPlace, clipAt, copyOf, erase, eraseMany, machineAt, machinesIn, moveMany, newId, paintBelts, pasteAt, place, rotate, setBelt, setSpeed, specFor, update, type Clip, type Tool, gantryAt } from './layoutOps';
import { areaAt, areasOf, fits, handleAt, laidArea, moved as movedArea, nameAt, resize, shapedArea, spanOf, type Handle } from './areas';
import { find, NO_FINDER, type Finder } from './finder';
import { FactoryFinder, FiltersTab } from './FactoryFinder';
import { ConsoleStrip, FactoryCounters } from './FactoryHudOverlay';
import { FactoryTalk, talkLog, useTalkReplies, useTicketVoices, type TalkTicket } from './FactoryTalk';
import { FloatingPortal, usePopover } from '../hooks/usePopover';
import { FactoryTicketTip, type TicketTipHandle } from './FactoryTicketTip';
import { FactoryLampTip, type LampTipHandle } from './FactoryLampTip';
import { FactoryNeeds } from './FactoryNeeds';
import { FactoryPeek, type PeekHandle } from './FactoryPeek';
import { FloatingExecutionPanel } from '../components/tickets/ExecutionModal';
import { needsOf, stepNeed } from './needs';
import { edgeCursorCss, useEdgeScroll } from './edgeScroll';
import { addTo, groupOf, machineIds, machinesSel, sameSelection, ticketIds, ticketsIn, ticketsSel } from './pick';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { FactoryWorkbench } from './FactoryWorkbench';
import { FactoryDeskForm } from './FactoryDeskForm';
import { FactoryItemPeek } from './FactoryItemPeek';
import { FactoryItemPopup, FactoryNewItem } from './FactoryItemPopup';
import { FactoryPlanModal } from './FactoryPlanModal';
import { FloorImportChoice, FloorImportReport } from './FactoryFloorImport';
import { exportFloor as floorToFile, floorFileName, readFloor, setupGap, type Dropped, type Known, type ReadFloor } from './floorFile';
import { loadModels } from '../hooks/useModels';
import { FactoryTicketsModal } from './FactoryTicketsModal';
import { FactoryExitLog } from './FactoryExitLog';
import { FactoryArchivedItemPopup, FactoryArchivedItems } from './FactoryArchivedItems';
import { loadConsoleHidden, loadShow, saveConsoleHidden, saveShow, type Show } from './viewToggles';
import { LENS_LABEL, lensLayer, type LensLayer } from './lens';
import { canSetAside, hasPopup, humanCall, needsHuman, RUNS, type AreaSpec, type DeskSpec, type Dir, type FactoryLayout, type Lens, type MachineSpec, type Selection, type StationSpec, type Target } from './types';

const MINIMAP_EVERY_MS = 150, MINIMAP_KEPT_MS = 1000;
/** No machine selected: the same list at every frame, for the view to see that nothing changed. */
const NONE: string[] = [];
/** Without the WS, the floor is polled: this often while the window is in front, */
const POLL_MS = 600;
/** and this often while it is behind others. */
const POLL_BACKGROUND_MS = 3000;
/** What says someone is at the page: the floor is drawn at its full rate for a moment after each. */
const WAKE_EVENTS = ['pointermove', 'pointerdown', 'pointerup', 'wheel', 'keydown', 'keyup', 'resize'] as const;
const STATS_EVERY_MS = 60_000;
/** A wait up to this long is left to the next animation frame; a longer one is spent in a timer that ends this early before it is due (see the draw loop). */
const SOON_MS = 12, EARLY_MS = 4;
/** Saved selections: keys 1 to 9, then 0. */
const GROUPS = 10;
/** The pointer over an edge of the page, where the view glides: an arrowhead towards that edge. */
const EDGE_CSS = edgeCursorCss('.factory-page');
/** Above this many, the tickets a filter keeps are ringed but not all named: the floor would be covered in text. */
const NAMED_MAX = 30;
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
/** What was copied or cut in build mode. Kept for the session, so it survives leaving the page and coming back. */
let clipboard: Clip | null = null;
const NO_TICKETS: never[] = [];
const ARROW = ['→', '↓', '←', '↑'];
/** The build menu: tool, hotkey, label, what it is. */
const TOOLS: [Tool, string, string, string][] = [
  ['belt', 'C', 'Belt', 'Drag to lay belts: each tile points the way you drag'],
  ['fastbelt', 'V', 'Fast belt', 'Drag to lay fast belts, twice as fast as plain ones: over belts already there, it speeds them up'],
  ['toll', 'L', 'Toll', 'A gantry that sets things on a ticket, then takes it off the belt when a condition holds'],
  ['set', 'E', 'Set', 'A gantry over a belt: sets fields and tags on every ticket that goes under it'],
  ['teleporter', 'T', 'Teleporter', 'A jump across the floor: a departure sends its ticket to the arrival it is set to'],
  ['bridge', 'H', 'Bridge', 'Where two belts cross: each ticket goes straight across, the lines do not mix'],
  ['arm', 'B', 'Arm', 'Takes from the tile behind it, drops on the tile in front. Against a station, a zone or a belt that ends there, it faces away from it by itself; a right click (or Face) turns it'],
  ['fastarm', '', 'Fast arm', 'An arm that swings twice as fast. It finds its way as an arm does; a right click (or Face) turns it'],
  ['agent', 'A', 'Agent', 'A station that runs a persona on the ticket'],
  ['skill', 'S', 'Skill', 'A station that runs a skill'],
  ['panel', 'N', 'Panel', 'A station that runs a panel of personas'],
  ['script', 'C', 'Script', 'A station that runs shell commands in the ticket\'s worktrees or its workspace'],
  ['gate', 'G', 'Gate', 'Waits for your decision; each outcome leaves by its own arm'],
  ['native', 'T', 'Status', 'Sets a status on the ticket and lets it through'],
  ['zone', 'D', 'Zone', 'Tickets wait here until released'],
  ['exit', 'O', 'Exit', 'Sets the ticket to done and hands it back to Fleex'],
  ['label', 'L', 'Label', 'A name on the floor'],
  ['area', '', 'Area', 'Drag a rectangle on the floor: an area, a part of it with a name and a colour. Areas nest or keep apart, never cross'],
  ['intake', 'I', 'Intake', 'Where items of one source come in: they wait while the conversation moves, what its rules recognise is dropped'],
  ['desk', 'K', 'Desk', 'Where tickets are born: New ticket opens the creation form on it'],
  ['erase', 'X', 'Erase', 'Click or drag to remove machines'],
];

type Press =
  | { kind: 'paint'; last: { x: number; y: number }; did: boolean; draft: FactoryLayout; fast: boolean }
  | { kind: 'erase'; draft: FactoryLayout }
  | { kind: 'machine'; id: string; sx: number; sy: number; dragging: boolean; group: string[] }
  | { kind: 'marquee'; x0: number; y0: number }
  | { kind: 'pan' }
  | { kind: 'place' }
  | { kind: 'ticket'; id: string; dragging: boolean; group: string[] }
  /* out of build mode: a frame dragged over the floor, which takes tickets */
  | { kind: 'pick'; x0: number; y0: number }
  /* build mode: an area drawn, resized by a side or a corner, or moved by its name */
  | { kind: 'area-draw'; ax: number; ay: number }
  | { kind: 'area-resize'; id: string; h: Handle }
  | { kind: 'area-move'; id: string; ax: number; ay: number; from: AreaSpec }
  | null;

/** The cursor over each handle of an area. */
const HANDLE_CURSOR: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
/** What a toast says when an area would cross another. */
const CROSSING = 'Areas nest or keep apart: this one would cross another';

function Disabled() {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center bg-[var(--theme-bg-base)] p-8">
      <div className="max-w-md text-center">
        <div className="text-base font-semibold text-[var(--theme-text-primary)]">The Factory is switched off</div>
        <p className="mt-2 text-sm text-[var(--theme-text-muted)]">It is an experimental feature. Switch it on in Settings › General to open the floor.</p>
      </div>
    </div>
  );
}

function TransferModal({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (ticketId: string) => void }) {
  const tickets = useTicketStore((s) => s.tickets), fetchTickets = useTicketStore((s) => s.fetchTickets);
  const managed = useFactoryStore((s) => s.managed);
  const [q, setQ] = useState('');
  useEffect(() => { if (open && tickets.length === 0) void fetchTickets(); }, [open, tickets.length, fetchTickets]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tickets.filter((t) => !t.archivedAt && t.status !== 'done' && t.status !== 'cancelled' && !managed.has(t.id) && (!needle || t.title.toLowerCase().includes(needle) || String(t.displayId).includes(needle))).slice(0, 60);
  }, [tickets, managed, q]);
  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-xl" variant="glass">
      <div className="flex max-h-[70vh] flex-col gap-3 p-4">
        <div>
          <div className="text-sm font-semibold text-[var(--theme-text-primary)]">Hand tickets over to the Factory</div>
          <p className="mt-1 text-xs text-[var(--theme-text-muted)]">A ticket you hand over lands in the Inbound zone and waits there. Drag it onto a belt or a machine to start it: from then on the floor drives it, and stations start real agent runs on it.</p>
        </div>
        <Input id="factory-transfer-search" placeholder="Search by title or number" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
          {rows.length === 0 && <div className="py-6 text-center text-xs text-[var(--theme-text-muted)]">No open ticket to hand over.</div>}
          {rows.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-md border border-[var(--theme-border)] px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--theme-text-primary)]"><span className="mr-1.5 font-mono text-[var(--theme-text-muted)]">#{t.displayId}</span>{t.title}</span>
              <span className="flex-shrink-0 text-[11px] text-[var(--theme-text-muted)]">{t.status}</span>
              <Button size="sm" onClick={() => onPick(t.id)}>Hand over</Button>
            </div>
          ))}
        </div>
        <div className="flex justify-end"><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div>
      </div>
    </Modal>
  );
}

export function FactoryPage() {
  const enabled = useFactoryStore((s) => s.enabled);
  const loadStatus = useFactoryStore((s) => s.loadStatus);
  useEffect(() => { void loadStatus(); }, [loadStatus]);
  return enabled ? <Floor /> : <Disabled />;
}

function Floor() {
  const store = useFactoryStore();
  const { snapshot, layout } = store;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /* the skin chosen in Settings paints the floor, and the page around it when it has colours of its own */
  const { skin, chrome, make: makeSkin, key: skinKey } = useFactorySkin(), skinRef = useRef(makeSkin);
  skinRef.current = makeSkin;
  const chromeStyle = useMemo<CSSProperties | undefined>(() => (chrome ? { ...chrome.vars, fontFamily: chrome.font ?? undefined, colorScheme: chrome.light ? 'light' : 'dark' } as CSSProperties : undefined), [chrome]);
  const viewRef = useRef<FactoryView | null>(null);
  const [view, setView] = useState<FactoryView | null>(null);
  const [building, setBuilding] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [dir, setDir] = useState<Dir>(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  /** The creation form, open on a desk (null: no desk on the floor, the ticket lands in Inbound); undefined when closed. */
  const [deskForm, setDeskForm] = useState<{ desk: DeskSpec | null } | undefined>(undefined);
  const [groups, setGroups] = useState<Selection[]>(() => Array.from({ length: GROUPS }, () => null));
  const [finder, setFinder] = useState<Finder>(NO_FINDER);
  const [hasClip, setHasClip] = useState(clipboard !== null);
  const tipRef = useRef<TicketTipHandle>(null);
  const lampTipRef = useRef<LampTipHandle>(null);
  /* the thread of the selected ticket, beside its machine: opened by a click on the ticket, closed by Escape */
  const peekRef = useRef<PeekHandle>(null);
  const [peekOpen, setPeekOpen] = useState(false);
  const peekFor = useRef<string | null>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const jumpAt = useRef(0);
  const groupsRef = useRef(groups); groupsRef.current = groups;
  /* the saved selections live with the floor: taken from the first snapshot, written back on each Shift+digit */
  const groupsLoaded = useRef(false);
  useEffect(() => {
    if (groupsLoaded.current || !snapshot) return;
    groupsLoaded.current = true;
    const saved = snapshot.floor.settings.groups;
    if (saved) setGroups(Array.from({ length: GROUPS }, (_, k) => saved[k] ?? null));
  }, [snapshot]);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const [openTicket, setOpenTicketRaw] = useState<string | null>(null);
  /** An item opened: its popup (an item has no workbench); and the intake an item is being made at by hand. */
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [newItemAt, setNewItemAt] = useState<string | null>(null);
  /* opening an item opens its popup, wherever it is opened from (Enter, a double-click, a list, the card) */
  const setOpenTicket = useCallback((id: string | null) => {
    const item = id ? useFactoryStore.getState().snapshot?.tickets.find((t) => t.ticketId === id)?.item : undefined;
    if (item) { setOpenItem(id); return; }
    setOpenTicketRaw(id);
  }, []);
  /* a run's log popped out of the peek card: it outlives the card */
  const [runLog, setRunLog] = useState<{ executionId: string; title: string } | null>(null);
  const [openMachine, setOpenMachine] = useState<string | null>(null);
  /* what left by an exit (`FactoryExitLog`): one exit (its double-click out of build mode, View), or every one (Exits, `machineId: null`) */
  const [exitLog, setExitLog] = useState<{ machineId: string | null } | null>(null);
  /* the archived items (`FactoryArchivedItems`): every intake's, or one intake's; and an archived item opened from it */
  const [archived, setArchived] = useState<{ intakeId: string | null } | null>(null);
  const [archivedItem, setArchivedItem] = useState<string | null>(null);
  const [floorOpen, setFloorOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  /* the console put away, to give the floor the whole page: kept in the browser like the toggles */
  const [hudHidden, setHudHidden] = useState(loadConsoleHidden);
  /* the filters, in a popup out of the Filters tab on the minimap; the floor stays live behind it */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filters = usePopover({ placement: 'top-start', gap: 6, role: 'dialog', open: filtersOpen, onOpenChange: setFiltersOpen, enableClick: false });
  const flipHud = useCallback(() => setHudHidden((h) => { saveConsoleHidden(!h); return !h; }), []);
  const [planOpen, setPlanOpen] = useState(false);
  /* a floor read from a file, while it is asked where it goes; then what was taken off its machines */
  const [importing, setImporting] = useState<{ name: string; read: Extract<ReadFloor, { ok: true }> } | null>(null);
  const [importReport, setImportReport] = useState<{ total: number; dropped: Dropped[]; unset: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** An import taken in hand: its report waits until it is put down (the machines get their ids then). */
  const pendingReport = useRef<{ order: string[]; total: number; dropped: Dropped[]; unset: number } | null>(null);
  const [listOpen, setListOpen] = useState(false);
  /* what the floor shows on top of the machines: kept in the browser from one visit to the next */
  const [show, setShow] = useState<Show>(loadShow);
  const flipShow = useCallback((key: keyof Show) => setShow((s) => { const next = { ...s, [key]: !s[key] }; saveShow(next); return next; }), []);
  const [lens, setLens] = useState<Lens>('none');
  const stats = useFactoryStore((s) => s.stats);
  /* the lens is worked out when its inputs change, not at every frame */
  const layer = useMemo<LensLayer | null>(() => (snapshot && layout ? lensLayer(lens, layout, snapshot.tickets, stats, snapshot.serverTime) : null), [lens, layout, snapshot, stats]);
  /* what the filter keeps; the rest is faded on the floor, never hidden */
  const found = useMemo(() => (snapshot ? find(snapshot.tickets, finder, (t) => humanCall(t) !== null) : null), [snapshot, finder]);
  const marks = useMemo(() => {
    if (!found || !snapshot) return { dim: null, found: null, named: null };
    const keep = new Set(found.map((t) => t.ticketId));
    return { dim: new Set(snapshot.tickets.filter((t) => !keep.has(t.ticketId)).map((t) => t.ticketId)), found: keep, named: keep.size <= NAMED_MAX ? keep : null };
  }, [found, snapshot]);
  const live = useRef({ turned: false, shownDir: 0 as Dir, building, tool, dir, selection, lens: layer, marks, hover: null as string | null, hoverLamp: null as string | null, ghost: null as Ghost | null, areaGhost: null as ViewState['areaGhost'], drag: null as DragState | null, marquee: null as ViewState['marquee'], pick: null as ReadonlySet<string> | null, space: false, show, unset: null as ReadonlySet<string> | null });
  if (live.current.tool !== tool) live.current.turned = false;
  live.current.building = building; live.current.tool = tool; live.current.dir = dir; live.current.selection = selection; live.current.lens = layer; live.current.marks = marks; live.current.show = show;
  const fitted = useRef(false);
  useToastOffset(262);   // keep toasts clear of the console
  /* Enter: the line to talk to the assistant or a ticket; while it is open, the messages are in its log, not over the floor */
  const [talkOpen, setTalkOpen] = useState(false);

  // Personas, skills and panels feed the station pickers.
  useEffect(() => {
    if (useAgentPersonaStore.getState().personas.length === 0) void useAgentPersonaStore.getState().loadPersonas();
    if (useSkillStore.getState().skills.length === 0) void useSkillStore.getState().loadSkills();
    if (usePanelStore.getState().panels.length === 0) void usePanelStore.getState().loadPanels();
  }, []);

  // Is the window the one in front, and when was someone last at the page: the draw loop and the poll pace themselves on it.
  const focused = useRef(typeof document === 'undefined' || document.hasFocus());
  const wokeAt = useRef(performance.now());
  /* a frame is owed now, whatever the pace: something changed that the loop would otherwise see at its next turn only */
  const owed = useRef(true);
  /* the draw loop's own: come back now instead of at the end of its wait (set by the loop) */
  const hurry = useRef<() => void>(() => {});
  useEffect(() => {
    const wake = () => { wokeAt.current = performance.now(); hurry.current(); };
    const onFocus = () => { focused.current = true; wake(); }, onBlur = () => { focused.current = false; };
    for (const e of WAKE_EVENTS) window.addEventListener(e, wake, { passive: true, capture: true });
    window.addEventListener('focus', onFocus); window.addEventListener('blur', onBlur);
    /*
     * A stopped floor is drawn twice a second: what changes on it is drawn at once, and that frame says
     * whether something moves now. One frame, not a moment at full rate: when the floor is polled, a snapshot comes
     * every 600 ms whether or not anything changed.
     */
    const unsub = useFactoryStore.subscribe((s, was) => {
      if (s.snapshot !== was.snapshot || s.layout !== was.layout || s.stats !== was.stats) { owed.current = true; hurry.current(); }
    });
    return () => {
      for (const e of WAKE_EVENTS) window.removeEventListener(e, wake, { capture: true });
      window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onBlur); unsub();
    };
  }, []);

  // Keep the floor live while the page is open (factoryLive.ts): pushed over the WS, polled when it is down.
  useEffect(() => watchFactory(() => (focused.current ? POLL_MS : POLL_BACKGROUND_MS)), []);

  // What the floor did: loaded with the page, then kept fresh while it stays open.
  useEffect(() => {
    void useFactoryStore.getState().loadStats();
    const id = window.setInterval(() => { if (!document.hidden) void useFactoryStore.getState().loadStats(); }, STATS_EVERY_MS);
    return () => window.clearInterval(id);
  }, []);

  const boardName = useCallback((id: string) => useTicketStore.getState().boards.find((b) => b.id === id)?.name ?? 'a board', []);
  const modelOf = useCallback((m: StationSpec) => stationModel(m, { personas: useAgentPersonaStore.getState().personas, skills: useSkillStore.getState().skills, panels: usePanelStore.getState().panels }), []);
  /* the same set for the same selection, frame after frame: the view keeps its picture while its state is the same */
  const picked = useRef<{ of: readonly string[]; set: ReadonlySet<string> } | null>(null);
  const pickedSet = useCallback((ids: readonly string[]): ReadonlySet<string> => {
    if (picked.current?.of !== ids) picked.current = { of: ids, set: new Set(ids) };
    return picked.current.set;
  }, []);
  const viewState = useCallback((): ViewState | null => {
    const s = useFactoryStore.getState(), l = live.current;
    if (!s.snapshot || !s.layout) return null;
    return {
      layout: s.layout, tickets: s.snapshot.tickets, arms: new Map(s.snapshot.arms.map((a) => [a.id, { p: a.p, state: a.state ?? 'rest' }])),
      /* stopped, an arm stays where the server last had it */
      halted: s.snapshot.floor.settings.halted === true, armAge: s.snapshot.floor.settings.halted ? 0 : (performance.now() - s.receivedAt) / 1000, armSwing: s.snapshot.armSwing, beltSpeed: s.snapshot.beltSpeed, fastBelt: s.snapshot.fastBelt, boardName, modelOf,
      selMachine: l.selection && 'machine' in l.selection ? l.selection.machine : null, selMany: l.selection && 'machines' in l.selection ? l.selection.machines : NONE, marquee: l.marquee, selTicket: l.selection && 'ticket' in l.selection ? l.selection.ticket : null,
      selTickets: l.selection && 'tickets' in l.selection ? pickedSet(l.selection.tickets) : null, pickTickets: l.pick,
      hoverMachine: l.hover, hoverLamp: l.hoverLamp, edit: l.building, ghost: l.ghost, drag: l.drag, lens: l.building ? null : l.lens,
      /* an area selected shows its handles, in build mode only (out of it, it is decor) */
      areaSel: l.building && l.selection && 'machine' in l.selection && s.layout.machines.some((m) => m.id === (l.selection as { machine: string }).machine && m.kind === 'area') ? l.selection.machine : null,
      areaGhost: l.building ? l.areaGhost : null,
      dim: l.marks.dim, found: l.marks.found, named: l.marks.named,
      allNames: l.show.names, armTags: l.show.arms, numbers: l.show.numbers, grid: l.show.grid,
      exits: s.stats?.exits ?? null, exitDays: s.stats?.days,
      intakes: s.snapshot.intakes ?? null,
      unset: l.unset,
    };
  }, [boardName, modelOf, pickedSet]);

  // The draw loop.
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const v = new FactoryView(cv, skinRef.current()); viewRef.current = v; setView(v);
    /* for whoever measures, from the console: `__factoryView.tally` counts the frames painted each way */
    if (import.meta.env.DEV) (window as unknown as { __factoryView?: FactoryView }).__factoryView = v;
    let raf = 0, timer = 0, last = performance.now(), miniAt = 0;
    owed.current = true;
    /*
     * The next look at the floor: at the next animation frame when it is due by then (at full rate); otherwise after
     * a wait that ends just before it is due, so that one animation frame is asked for each frame drawn. Asking for
     * one at every refresh of the screen to find that it is too early is not free: each has the page run a whole
     * frame of its own (styles, layout, commit), 120 times a second on a fast screen for 30 frames drawn, and
     * measured on a real floor that was most of what the page's process spent.
     */
    const again = (wait: number) => {
      if (wait <= SOON_MS) { raf = requestAnimationFrame(frame); return; }
      timer = window.setTimeout(() => { timer = 0; raf = requestAnimationFrame(frame); }, wait - EARLY_MS);
    };
    hurry.current = () => { if (!timer) return; window.clearTimeout(timer); timer = 0; raf = requestAnimationFrame(frame); };
    const frame = (ts: number) => {
      /* drawn only as often as what is going on calls for (frameRate.ts): never more than 60 a second */
      const gap = () => { const snap = useFactoryStore.getState().snapshot; return frameGap({ sinceWake: performance.now() - wokeAt.current, focused: focused.current, running: !!snap && snap.floor.settings.halted !== true, moving: v.moving }); };
      const wait = gap() - (ts - last);
      /* a hair early is due: the next refresh of the screen would be later than asked */
      if (wait > EARLY_MS / 2 && !owed.current) { again(wait); return; }
      owed.current = false;
      const dt = Math.min(MAX_STEP_S, Math.max(0, (ts - last) / 1000)); last = ts;
      const st = viewState();
      if (st) {
        if (!fitted.current) { v.fit(st.layout, false); fitted.current = true; }
        v.draw(st, dt);
        if (peekFor.current) { const r = v.anchorOf(peekFor.current, st); if (r) peekRef.current?.place(r); }
        /* a picture kept shows nothing new: the minimap, painted whole each time, is then given a second */
        if (ts - miniAt > (v.painted === 'kept' ? MINIMAP_KEPT_MS : MINIMAP_EVERY_MS) && miniRef.current) { miniAt = ts; v.minimap(miniRef.current, st); }
      }
      /* what was just drawn says how soon the next one is due */
      again(gap());
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(timer); hurry.current = () => {}; };
  }, [viewState]);

  const commit = useCallback((next: FactoryLayout | null) => { if (next) void useFactoryStore.getState().setLayout(next); else toast.warning('No room here'); }, []);
  const removeMachine = useCallback((id: string) => {
    const l = useFactoryStore.getState().layout; if (!l) return;
    commit(erase(l, id)); setSelection((s) => (s && 'machine' in s && s.machine === id ? null : s));
  }, [commit]);
  const patchMachine = useCallback((id: string, patch: Partial<MachineSpec>) => {
    const l = useFactoryStore.getState().layout; if (!l) return;
    const m = l.machines.find((q) => q.id === id); if (!m) return;
    if (('w' in patch || 'h' in patch) && !canPlace(l, { x: m.x, y: m.y, w: patch.w ?? m.w, h: patch.h ?? m.h }, id)) { toast.warning('No room to resize here'); return; }
    // One Inbound zone per floor: ticking it on a zone takes it off the others.
    const base = 'inbound' in patch && patch.inbound ? { ...l, machines: l.machines.map((q) => (q.kind === 'zone' && q.id !== id && q.inbound ? { ...q, inbound: false } : q)) } : l;
    commit(update(base, id, patch));
  }, [commit]);

  /** Whether several tickets can be dropped together on a target: only where there is room for many. */
  const groupTarget = (v: FactoryView, target: Target): boolean => {
    const m = target.machineId ? v.machine(target.machineId) : null;
    return !!m && (m.kind === 'zone' || m.kind === 'station' || m.kind === 'exit');
  };
  const dropTarget = (v: FactoryView, wx: number, wy: number): { target: Target; ok: boolean; can: boolean; text: string } => {
    const tx = Math.floor(wx), ty = Math.floor(wy), m = v.at(tx, ty);
    if (!m) return { target: { x: tx, y: ty }, ok: false, can: true, text: 'On the floor: it will not move by itself' };
    if (m.kind === 'arm' || m.kind === 'label') return { target: {}, ok: false, can: false, text: 'Not on an arm' };
    if (m.kind === 'desk') return { target: {}, ok: false, can: false, text: 'Not on a desk: tickets are born there' };
    if (m.kind === 'intake') return { target: {}, ok: false, can: false, text: 'Not in an intake: items come to it from their source' };
    if (m.kind === 'teleporter') {
      /* as for an arm: a departure takes one ticket, an arrival none */
      const held = !!useFactoryStore.getState().snapshot?.tickets.some((t) => t.machineId === m.id), drop = portDrop(m, held, arrivalOf(m, (id) => v.machine(id)));
      return { target: drop.ok ? { machineId: m.id } : {}, ok: drop.ok, can: drop.ok, text: drop.text };
    }
    const dest = m.kind === 'belt' ? v.leadsTo(m) : null;
    return { target: { machineId: m.id }, ok: true, can: true, text: m.kind === 'belt' ? `Belt ${ARROW[m.dir]}${dest ? ` towards ${dest.name ?? dest.kind}` : ': leads nowhere'}` : m.kind === 'exit' ? 'Ship: sets it to done' : `Drop in ${m.name ?? m.kind}` };
  };

  // ---------- pointer ----------
  const press = useRef<Press>(null);
  const moved = useRef(0);
  const lastPt = useRef({ x: 0, y: 0 });
  const local = (e: React.PointerEvent | React.WheelEvent | React.MouseEvent) => { const r = canvasRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  /*
   * The way what is in hand faces: an arm reads it from what is round it (`armFacing`: from the station, the zone or
   * the belt that gives, away from it), until it is turned by hand; the rest faces the way chosen.
   */
  const handDir = (l: FactoryLayout, t: Tool, x: number, y: number): Dir => ((t === 'arm' || t === 'fastarm') && !live.current.turned ? armFacing(l, x, y, live.current.dir) : live.current.dir);
  /* a quarter turn of what is in hand, from the way it is shown: then it stays as turned until it is put down */
  const turnInHand = () => { const next = ((live.current.shownDir + 1) % 4) as Dir; live.current.turned = true; live.current.dir = next; live.current.shownDir = next; setDir(next); };
  const ghostAt = (v: FactoryView, wx: number, wy: number): Ghost | null => {
    const l = useFactoryStore.getState().layout, t = live.current.tool;
    if (!live.current.building || t === 'select' || !l) return null;
    const x = Math.floor(wx), y = Math.floor(wy);
    if (t === 'erase') { const m = machineAt(l, x, y); return { cells: [m ?? { x, y, w: 1, h: 1 }], ok: true, erase: true }; }
    if (t === 'paste') {
      if (!clipboard) return null;
      const cells = clipAt(clipboard, x, y).map((m) => ({ x: m.x, y: m.y, w: m.w, h: m.h, dir: m.kind === 'belt' || m.kind === 'arm' ? m.dir : undefined }));
      return { cells, ok: canPaste(l, clipboard, x, y), text: cells.length > 1 ? `Paste ${cells.length} machines` : 'Paste' };
    }
    if (t === 'set' || t === 'toll') return { cells: [{ x, y, w: 1, h: 1 }], ok: !!gantryAt(l, x, y, live.current.dir, t === 'toll'), text: t === 'toll' ? 'Toll' : 'Set gantry' };
    const spec = specFor(t, x, y, handDir(l, t, x, y)); if (!spec) return null;
    if (spec.kind === 'arm' || spec.kind === 'belt') live.current.shownDir = spec.dir;
    return { cells: [{ x: spec.x, y: spec.y, w: spec.w, h: spec.h, dir: spec.kind === 'belt' || spec.kind === 'arm' ? spec.dir : undefined, arm: spec.kind === 'arm' }], ok: canPlace(l, spec) };
  };

  /** In build mode, what a press on an area takes hold of: a handle of the one selected, or the name of one, to move it. */
  const grabArea = (v: FactoryView, wx: number, wy: number): Press => {
    const l = useFactoryStore.getState().layout; if (!l) return null;
    const areas = areasOf(l.machines), sel = live.current.selection, picked = sel && 'machine' in sel ? areas.find((a) => a.id === sel.machine) : null;
    const h = picked ? handleAt(picked, wx, wy, Math.max(0.2, 8 / v.cam.z)) : null;
    if (picked && h) return { kind: 'area-resize', id: picked.id, h };
    const named = nameAt(areas, wx, wy);
    return named ? { kind: 'area-move', id: named.id, ax: wx, ay: wy, from: named } : null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const v = viewRef.current, st = viewState(); if (!v || !st) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e), w = v.toWorld(p.x, p.y), tx = Math.floor(w.x), ty = Math.floor(w.y);
    /* a right click turns what is in hand, a quarter turn, and puts nothing down (anywhere else it moves the view) */
    if (e.button === 2 && live.current.building && ['arm', 'fastarm', 'belt', 'fastbelt', 'set', 'toll'].includes(live.current.tool)) {
      press.current = null; turnInHand(); live.current.ghost = ghostAt(v, w.x, w.y);
      return;
    }
    moved.current = 0; lastPt.current = p; press.current = null; tipRef.current?.hide(); lampTipRef.current?.hide();
    /* right or middle button, or Space held: move the view, whatever the tool */
    if (e.button !== 0 || live.current.space) { press.current = { kind: 'pan' }; e.currentTarget.style.cursor = 'grabbing'; return; }
    if (live.current.building) {
      const t = live.current.tool;
      if (t === 'belt' || t === 'fastbelt') { store.beginEdit(); press.current = { kind: 'paint', last: { x: tx, y: ty }, did: false, draft: st.layout, fast: t === 'fastbelt' }; }
      else if (t === 'erase') { store.beginEdit(); const m = machineAt(st.layout, tx, ty); const draft = m ? erase(st.layout, m.id) : st.layout; store.previewLayout(draft); press.current = { kind: 'erase', draft }; }
      else if (t === 'area') { const r = spanOf(w.x, w.y, w.x, w.y); live.current.areaGhost = { ...r, ok: fits(r, areasOf(st.layout.machines), 'nest') }; press.current = { kind: 'area-draw', ax: w.x, ay: w.y }; }
      else if (t === 'select') {
        const hit = v.pick(p.x, p.y, st, false), m = hit && 'machineId' in hit ? v.machine(hit.machineId) : null, area = grabArea(v, w.x, w.y);
        /* the handles of the area selected first, then what stands on the floor, then an area's name, which moves it */
        if (area?.kind === 'area-resize' || (area && !m)) { press.current = area; if (area.kind === 'area-move') setSelection({ machine: area.id }); }
        else if (m) { const sel = live.current.selection, group = sel && 'machines' in sel && sel.machines.includes(m.id) ? sel.machines : [m.id]; press.current = { kind: 'machine', id: m.id, sx: tx, sy: ty, dragging: false, group }; }
        else press.current = { kind: 'marquee', x0: w.x, y0: w.y };
      } else press.current = { kind: 'place' };
    } else {
      const hit = v.pick(p.x, p.y, st, true);
      if (hit && 'ticketId' in hit) {
        /* one of several tickets selected together: they are all in hand */
        const sel = live.current.selection, group = sel && 'tickets' in sel && sel.tickets.includes(hit.ticketId) ? sel.tickets : [hit.ticketId];
        press.current = { kind: 'ticket', id: hit.ticketId, dragging: false, group };
      } else if (!(hit && 'lamp' in hit)) press.current = { kind: 'pick', x0: w.x, y0: w.y };   // anywhere else, a drag is a frame that takes tickets
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const v = viewRef.current, st = viewState(); if (!v || !st) return;
    const p = local(e), w = v.toWorld(p.x, p.y), tx = Math.floor(w.x), ty = Math.floor(w.y), pr = press.current;
    if (e.buttons === 0) {
      const hit = v.pick(p.x, p.y, st, !live.current.building);
      live.current.hover = hit && 'machineId' in hit ? hit.machineId : null;
      live.current.hoverLamp = hit && 'lamp' in hit ? hit.lamp : null;
      live.current.ghost = ghostAt(v, w.x, w.y);
      /* a ticket says what it is as soon as the pointer is over it, and so does a machine's light */
      if (hit && 'ticketId' in hit) tipRef.current?.show(hit.ticketId, p.x, p.y); else tipRef.current?.hide();
      if (hit && 'lamp' in hit) lampTipRef.current?.show(hit.lamp, p.x, p.y); else lampTipRef.current?.hide();
      const grab = live.current.building && live.current.tool === 'select' ? grabArea(v, w.x, w.y) : null;
      e.currentTarget.style.cursor = live.current.space ? 'grab' : grab?.kind === 'area-resize' ? HANDLE_CURSOR[grab.h] : grab?.kind === 'area-move' && !hit ? 'move' : hit && 'lamp' in hit ? 'pointer' : '';
      return;
    }
    const dx = p.x - lastPt.current.x, dy = p.y - lastPt.current.y; moved.current += Math.abs(dx) + Math.abs(dy); lastPt.current = p;
    if (pr?.kind === 'paint') {
      if (tx !== pr.last.x || ty !== pr.last.y) { const r = paintBelts(pr.draft, pr.last, { x: tx, y: ty }, pr.fast); pr.draft = r.layout; pr.last = { x: tx, y: ty }; pr.did = true; if (r.dir != null) setDir(r.dir); store.previewLayout(pr.draft); }
    } else if (pr?.kind === 'erase') {
      const m = machineAt(pr.draft, tx, ty); if (m) { pr.draft = erase(pr.draft, m.id); store.previewLayout(pr.draft); }
    } else if (pr?.kind === 'machine') {
      if (moved.current > 5) {
        pr.dragging = true;
        const ids = new Set(pr.group), ox = tx - pr.sx, oy = ty - pr.sy, cells = st.layout.machines.filter((m) => ids.has(m.id)).map((m) => ({ x: m.x + ox, y: m.y + oy, w: m.w, h: m.h, label: m.kind === 'label' }));
        live.current.ghost = { cells, ok: cells.every((c) => c.label || canPlace(st.layout, c, ids)), text: pr.group.length > 1 ? `Move ${pr.group.length} machines` : 'Move' };
      }
    } else if (pr?.kind === 'area-draw' || pr?.kind === 'area-resize' || pr?.kind === 'area-move') {
      /* the area as it would be let go now, and whether it may be there */
      const areas = areasOf(st.layout.machines), was = pr.kind === 'area-draw' ? null : areas.find((a) => a.id === pr.id);
      if (pr.kind !== 'area-draw' && !was) return;
      if (pr.kind === 'area-move' && moved.current <= 5) return;
      const r = pr.kind === 'area-draw' ? spanOf(pr.ax, pr.ay, w.x, w.y) : pr.kind === 'area-resize' ? resize(was!, pr.h, w.x, w.y) : movedArea(pr.from, w.x - pr.ax, w.y - pr.ay);
      live.current.areaGhost = { ...r, ok: fits(r, areas.filter((a) => a.id !== was?.id), 'nest') };
    } else if (pr?.kind === 'marquee') {
      live.current.marquee = { x0: pr.x0, y0: pr.y0, x1: w.x, y1: w.y };
    } else if (pr?.kind === 'pick') {
      /* the frame, and the tickets it would take if it were let go now: they show it at once */
      if (moved.current > 5) {
        const frame = { x0: pr.x0, y0: pr.y0, x1: w.x, y1: w.y };
        live.current.marquee = frame; live.current.pick = new Set(ticketsIn(v.ticketPlaces(), frame));
      }
    } else if (pr?.kind === 'ticket') {
      if (moved.current > 5) {
        pr.dragging = true;
        const d = dropTarget(v, w.x, w.y), many = pr.group.length > 1, box = many && groupTarget(v, d.target);
        live.current.drag = { ticketId: pr.id, x: w.x, y: w.y, ok: many ? !!box : d.ok, text: many ? (box ? `${pr.group.length} tickets: ${d.text}` : `${pr.group.length} tickets go together into a zone, a station or an exit`) : d.text };
      }
    } else if (pr?.kind === 'pan') { v.cam.x -= dx / v.cam.z; v.cam.y -= dy / v.cam.z; }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const v = viewRef.current, st = viewState(), pr = press.current; press.current = null;
    if (!v || !st) return;
    const p = local(e), w = v.toWorld(p.x, p.y), tx = Math.floor(w.x), ty = Math.floor(w.y), click = moved.current <= 5;
    if (pr?.kind === 'pick') { live.current.marquee = null; live.current.pick = null; }
    if (pr?.kind === 'pan') { e.currentTarget.style.cursor = live.current.space ? 'grab' : ''; return; }
    if (pr?.kind === 'paint') {
      /* a click lays one tile, or re-aims the belt that is there; on a belt of the other speed, it only changes its speed */
      const there = machineAt(pr.draft, tx, ty);
      const final = pr.did || !click ? pr.draft
        : there?.kind === 'belt' && !!there.fast !== pr.fast ? setBelt(pr.draft, tx, ty, there.dir, pr.fast)
        : place(pr.draft, specFor(pr.fast ? 'fastbelt' : 'belt', tx, ty, live.current.dir)!) ?? pr.draft;
      void store.setLayout(final).finally(() => store.endEdit());
    } else if (pr?.kind === 'erase') { void store.setLayout(pr.draft).finally(() => store.endEdit()); }
    else if (pr?.kind === 'machine') {
      const g = live.current.ghost; live.current.ghost = null;
      if (pr.dragging && g) { if (g.ok) commit(moveMany(st.layout, new Set(pr.group), tx - pr.sx, ty - pr.sy)); else toast.warning('No room here'); }
      /* Shift adds the machine to what is selected, or takes it out; a drag moved it and leaves the selection alone */
      if (!pr.dragging && e.shiftKey) setSelection(machinesSel(addTo(machineIds(live.current.selection), [pr.id], true, true)));
      else if (!pr.dragging || pr.group.length === 1) setSelection({ machine: pr.id });
    } else if (pr?.kind === 'area-draw' || pr?.kind === 'area-resize' || pr?.kind === 'area-move') {
      const g = live.current.areaGhost; live.current.areaGhost = null;
      if (!g || (pr.kind === 'area-move' && click)) return;
      const r = { x: g.x, y: g.y, w: g.w, h: g.h };
      if (!g.ok) { toast.warning(CROSSING); return; }
      if (pr.kind === 'area-draw') {
        const done = laidArea(st.layout, r, newId());
        if (done) { commit(done.layout); setTool('select'); setSelection({ machine: done.area.id }); } else toast.warning(CROSSING);
      } else { const done = shapedArea(st.layout, pr.id, r); if (done) commit(done); else toast.warning(CROSSING); }
    } else if (pr?.kind === 'marquee') {
      const q = live.current.marquee; live.current.marquee = null;
      /* a click on the floor selects the area there (the innermost), if any; a frame selects machines, never areas */
      const under = click && !e.shiftKey ? areaAt(areasOf(st.layout.machines), w.x, w.y) : null;
      if (under) { setSelection({ machine: under.id }); return; }
      const ids = q && !click ? machinesIn(st.layout, q.x0, q.y0, q.x1, q.y1) : [];
      /* with Shift a frame adds to the selection, and a click on bare floor leaves it as it is */
      setSelection(machinesSel(e.shiftKey ? addTo(machineIds(live.current.selection), ids, true) : ids));
    } else if (pr?.kind === 'place') {
      if (click && live.current.tool === 'paste') {
        const done = clipboard ? pasteAt(st.layout, clipboard, tx, ty) : null;
        if (done) {
          commit(done.layout); setTool('select'); setSelection(done.ids.length > 1 ? { machines: done.ids } : { machine: done.ids[0]! }); live.current.ghost = null;
          const r = pendingReport.current; pendingReport.current = null;
          if (r) {
            const to = new Map(r.order.map((id, i) => [id, done.ids[i] ?? id]));
            afterImport(r.total, r.dropped.map((d) => ({ ...d, machineId: to.get(d.machineId) ?? d.machineId })), r.unset);
          }
        }
        else toast.warning('No room to paste here');
      } else if (click && (live.current.tool === 'set' || live.current.tool === 'toll')) {
        /* on the belt that is there, or with a belt of its own */
        const done = gantryAt(st.layout, tx, ty, live.current.dir, live.current.tool === 'toll');
        if (done) { commit(done.layout); setTool('select'); setSelection({ machine: done.id }); live.current.ghost = null; }
        else toast.warning('A gantry goes on a belt, or on bare floor');
      } else if (click) {
        const spec = specFor(live.current.tool, tx, ty, handDir(st.layout, live.current.tool, tx, ty)), next = spec ? place(st.layout, spec) : null;
        commit(next);
        /* the next arm in hand reads its way from where it goes again */
        if (next && spec?.kind === 'arm') live.current.turned = false;
        if (next && spec && spec.kind !== 'arm' && spec.kind !== 'bridge') { setTool('select'); setSelection({ machine: spec.id }); live.current.ghost = null; }
      }
    } else if (pr?.kind === 'ticket') {
      const dr = live.current.drag; live.current.drag = null;
      if (pr.dragging && dr && pr.group.length > 1) {
        /* several tickets in hand go together, one after the other, where there is room for many */
        const d = dropTarget(v, dr.x, dr.y), ids = pr.group;
        if (groupTarget(v, d.target)) void (async () => { for (const id of ids) await store.move(id, d.target); })();
        else toast.warning('Several tickets go together into a zone, a station or an exit');
        return;
      }
      if (pr.dragging && dr) { const d = dropTarget(v, dr.x, dr.y); if (d.can) void store.move(pr.id, d.target); else toast.warning(d.text); }
      if (!pr.dragging && e.shiftKey) { setSelection(ticketsSel(addTo(ticketIds(live.current.selection), [pr.id], true, true))); setPeekOpen(false); }
      else { setSelection({ ticket: pr.id }); setPeekOpen(!pr.dragging); }
    } else if (pr?.kind === 'pick' && !click) {
      const ids = ticketsIn(v.ticketPlaces(), { x0: pr.x0, y0: pr.y0, x1: w.x, y1: w.y });
      setSelection(ticketsSel(e.shiftKey ? addTo(ticketIds(live.current.selection), ids, true) : ids));
      setPeekOpen(false);
    } else if (click) {
      const hit = v.pick(p.x, p.y, st, !live.current.building);
      if (hit && 'lamp' in hit) {
        /* the light of a machine that runs something is its switch; a gate's only speaks */
        const m = v.machine(hit.lamp);
        if (m?.kind === 'station' && RUNS.includes(m.exec)) void store.power(m.id, !!m.off);
      } else if (hit || !e.shiftKey) { setSelection(hit ? ('ticketId' in hit ? { ticket: hit.ticketId } : { machine: hit.machineId }) : null); setPeekOpen(!!hit && 'ticketId' in hit); }
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => { const v = viewRef.current; if (!v) return; const p = local(e); v.wheel(p.x, p.y, e.deltaY, e.ctrlKey, e.deltaMode === 1); };
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const v = viewRef.current, st = viewState(); if (!v || !st) return;
    const p = local(e), hit = v.pick(p.x, p.y, st, true);
    if (hit && 'ticketId' in hit) { setOpenTicket(hit.ticketId); return; }
    /* a machine opens in its popup: its settings, what it holds, what it did. In build mode too, with nothing in hand */
    const m = hit && 'machineId' in hit && (!live.current.building || live.current.tool === 'select') ? v.machine(hit.machineId) : null;
    /* a desk opens its form out of build mode, which is what it is for; its settings are Edit */
    if (m?.kind === 'desk' && !live.current.building) { setDeskForm({ desk: m }); return; }
    /* an exit opens on what left by it; its settings are a button away there, and in build mode */
    if (m?.kind === 'exit' && !live.current.building) { setExitLog({ machineId: m.id }); return; }
    if (m && hasPopup(m)) { setOpenMachine(m.id); return; }
    /* in build mode, an area opens where nothing stands on it */
    if (!hit && live.current.building && live.current.tool === 'select') {
      const w = v.toWorld(p.x, p.y), a = areaAt(areasOf(st.layout.machines), w.x, w.y);
      if (a) { setSelection({ machine: a.id }); setOpenMachine(a.id); }
    }
  };

  // ---------- commands and their keys ----------
  const selMachine = selection && 'machine' in selection && layout ? layout.machines.find((m) => m.id === selection.machine) ?? null : null;
  const selMany = useMemo(() => (selection && 'machines' in selection ? selection.machines : []), [selection]);
  const selTicket = selection && 'ticket' in selection && snapshot ? snapshot.tickets.find((t) => t.ticketId === selection.ticket) ?? null : null;
  /* several tickets selected together (a frame dragged out of build mode): those of them still on the floor */
  const selTickets = useMemo(() => {
    if (!selection || !('tickets' in selection) || !snapshot) return [];
    const ids = new Set(selection.tickets);
    return snapshot.tickets.filter((t) => ids.has(t.ticketId));
  }, [selection, snapshot]);
  const group = useMemo(() => (selTickets.length > 0 && layout ? groupOf(selTickets, layout.machines) : null), [selTickets, layout]);
  const [confirmGive, setConfirmGive] = useState(false);
  /* messages over the floor while one looks at the floor; a window opened over it (a ticket, a machine, a list) gets
     Fleex's usual cards, which sit over it, and the lines come back once it is closed */
  const windowOpen = !!(transferOpen || deskForm || openItem || newItemAt || openTicket || openMachine || exitLog || archived || archivedItem
    || floorOpen || limitsOpen || listOpen || planOpen || importing || importReport || confirmGive);
  useToastSkin(windowOpen ? null : talkOpen ? 'quiet' : 'floor', chromeStyle as Record<string, string | number> | undefined);
  const closeMachine = useCallback(() => setOpenMachine(null), []);
  /* from one machine's popup to another's (a station's arm): the floor's selection follows */
  const openMachineOn = useCallback((id: string) => { setSelection({ machine: id }); setOpenMachine(id); }, []);
  /* select a machine and bring it to the middle of the view */
  const showMachine = useCallback((id: string) => {
    const m = useFactoryStore.getState().layout?.machines.find((q) => q.id === id), v = viewRef.current;
    if (!m) return;
    setSelection({ machine: id });
    if (v) { v.cam.x = m.x + m.w / 2; v.cam.y = m.y + m.h / 2; }
  }, []);
  const transferTo = useCallback((ticketId: string) => { void useFactoryStore.getState().transfer(ticketId, {}); }, []);

  const fit = useCallback(() => { const l = useFactoryStore.getState().layout; if (l && viewRef.current) viewRef.current.fit(l, live.current.building); }, []);
  /** Centre the view on a ticket and select it. */
  const goTo = useCallback((ticketId: string) => {
    const v = viewRef.current, p = v?.ticketPos(ticketId);
    if (v && p) { v.cam.x = p.x; v.cam.y = p.y; if (v.cam.z < 22) v.cam.z = 22; }
    setSelection({ ticket: ticketId });
  }, []);
  /* what waits for someone: listed top-left, and walked with the left and right arrows */
  const needs = useMemo(() => (snapshot && layout ? needsOf(snapshot.tickets, layout.machines, snapshot.serverTime) : []), [snapshot, layout]);
  const pickNeed = useCallback((ticketId: string) => { goTo(ticketId); setPeekOpen(true); }, [goTo]);
  /* who the line talks to besides the assistant: the ticket selected, else the first ticket that needs you */
  /* a ticket as the line names it: its number and title, where it stands, the station it is at */
  const describeTicket = useCallback((ticketId: string): TalkTicket | null => {
    const s = useFactoryStore.getState(), t = s.snapshot?.tickets.find((x) => x.ticketId === ticketId);
    if (!t || t.item) return null;
    const m = t.machineId ? s.layout?.machines.find((q) => q.id === t.machineId) : null;
    const title = t.info?.title ?? '';
    return { ticketId, label: `#${t.info?.displayId ?? '?'}${title ? ` ${title.length > 28 ? `${title.slice(0, 27)}…` : title}` : ''}`, phase: t.phase, note: t.note, station: m && 'name' in m ? m.name || undefined : undefined,
      released: t.released, favorite: t.info ? t.info.favorite : null, canAside: canSetAside(t, m ?? undefined) };
  }, []);
  /* who the line talks to besides the assistant: the ticket selected, else the last one that wrote to you, else the first that needs you */
  const talkTicket = useMemo((): TalkTicket | null => {
    const id = selTicket && !selTicket.item ? selTicket.ticketId
      : (talkLog.lastSpoke && snapshot?.tickets.some((t) => t.ticketId === talkLog.lastSpoke!.ticketId) ? talkLog.lastSpoke.ticketId : null)
        ?? needs.find((n) => !n.ticket.item)?.ticket.ticketId ?? null;
    return id ? describeTicket(id) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selTicket?.ticketId, talkOpen, describeTicket]);
  useTicketVoices(snapshot?.tickets ?? NO_TICKETS, describeTicket, setOpenTicket);
  /* the other tickets Tab reaches in the line: every ticket that needs you (items have no thread) */
  const needIds = needs.filter((n) => !n.ticket.item).map((n) => n.ticket.ticketId).join(',');
  const talkOthers = useMemo(() => (needIds ? needIds.split(',').map(describeTicket).filter((t): t is TalkTicket => !!t) : []), [needIds, describeTicket]);
  useTalkReplies(setOpenTicket);
  /* the stations that cannot run yet (no persona, skill or panel, or one this instance does not have; a script with nothing to run) */
  const personas = useAgentPersonaStore((s) => s.personas), skills = useSkillStore((s) => s.skills), panels = usePanelStore((s) => s.panels);
  const unset = useMemo(() => {
    const known = { personas: personas.map((p) => p.name), skills: skills.map((k) => k.commandName), panels: panels.map((p) => p.name) };
    return (layout?.machines ?? []).flatMap((m) => { const gap = setupGap(m, known); return gap ? [{ id: m.id, name: ('name' in m && m.name) || 'Station', gap }] : []; });
  }, [layout, personas, skills, panels]);
  live.current.unset = unset.length ? new Set(unset.map((u) => u.id)) : null;
  /* to the next ticket that waits for someone, or the one before, round and round */
  const stepWaiting = useCallback((dir: 1 | -1) => {
    const sel = live.current.selection, next = stepNeed(needs, sel && 'ticket' in sel ? sel.ticket : null, dir);
    if (next) pickNeed(next);
  }, [needs, pickNeed]);

  // The edges of the page move the view: the left one against the app's navigation, the top one under the bar, the right and the bottom ones at the window's.
  const edgeRect = useCallback(() => {
    const root = rootRef.current, cv = canvasRef.current;
    if (!root || !cv) return null;
    const r = root.getBoundingClientRect();
    return { left: r.left, top: cv.getBoundingClientRect().top, right: r.right, bottom: r.bottom };
  }, []);
  const edgeMove = useCallback((dx: number, dy: number) => { wokeAt.current = performance.now(); const v = viewRef.current; if (v) { v.cam.x += dx / v.cam.z; v.cam.y += dy / v.cam.z; } }, []);
  /* not while the view is being dragged: one hand moves it at a time */
  const edgePaused = useCallback(() => press.current?.kind === 'pan', []);
  useEdgeScroll(rootRef, edgeRect, edgeMove, edgePaused);
  peekFor.current = peekOpen && selTicket && !building ? selTicket.ticketId : null;
  /* the workbench: a ticket opened over the floor. Moving to another one in it selects that one on the floor too, so the floor is on it when the workbench goes down */
  const openOn = useCallback((ticketId: string) => { setSelection({ ticket: ticketId }); setOpenTicket(ticketId); }, []);
  const closeTicket = useCallback(() => setOpenTicket(null), []);
  /** Enter in the search box: the next ticket found, round and round. */
  const jump = useCallback(() => {
    if (!found?.length) return;
    const t = found[jumpAt.current % found.length]!; jumpAt.current = (jumpAt.current + 1) % found.length;
    goTo(t.ticketId);
  }, [found, goTo]);
  useEffect(() => { jumpAt.current = 0; }, [finder]);

  // ---------- copy, cut, paste (build mode) ----------
  const copy = useCallback((cut: boolean) => {
    const sel = live.current.selection, l = useFactoryStore.getState().layout;
    const ids = sel && 'machines' in sel ? sel.machines : sel && 'machine' in sel ? [sel.machine] : [];
    const clip = l && ids.length ? copyOf(l, new Set(ids)) : null;
    if (!l || !clip) { toast.info('Select one or several machines first'); return; }
    clipboard = clip; setHasClip(true); pendingReport.current = null;
    if (cut) { commit(eraseMany(l, new Set(ids))); setSelection(null); }
    toast.info(`${clip.machines.length} machine${clip.machines.length === 1 ? '' : 's'} ${cut ? 'cut' : 'copied'}: ${MOD}V, then click where to put ${clip.machines.length === 1 ? 'it' : 'them'}`);
  }, [commit]);
  const paste = useCallback(() => {
    if (!clipboard) { toast.info('Nothing to paste: copy or cut machines first'); return; }
    setSelection(null); setTool('paste');
  }, []);

  /** A plan is put down like anything copied: it follows the pointer until a click says where. */
  const placePlan = useCallback((clip: Clip, name: string, say?: string) => {
    clipboard = clip; setHasClip(true); pendingReport.current = null; setPlanOpen(false); setSelection(null); setTool('paste');
    /* a plan is often wider than what is on screen: step back until it can be seen whole while it is carried */
    const v = viewRef.current;
    if (v) v.cam.z = Math.max(5, Math.min(v.cam.z, 0.7 * Math.min(v.w / clip.w, v.h / clip.h)));
    toast.info(say ?? `Plan “${name}”: click on the floor where it should go. Escape puts it down; ${MOD}V picks it up again.`);
  }, []);

  // ---------- export and import (build mode) ----------
  const downloadFloor = useCallback(() => {
    const l = useFactoryStore.getState().layout; if (!l) return;
    const sel = live.current.selection, ids = sel && 'machines' in sel ? sel.machines : sel && 'machine' in sel ? [sel.machine] : [];
    const file = floorToFile(l, useTicketStore.getState().boards, ids.length ? new Set(ids) : null);
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = floorFileName(); a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    const n = file.layout.machines.length;
    toast.success(`${n} machine${n === 1 ? '' : 's'} exported`);
  }, []);
  /** What this instance has, by name: loaded first when it is not yet, since what is missing is taken off the machines. */
  const knownHere = useCallback(async (): Promise<Known | null> => {
    const P = useAgentPersonaStore.getState(), S = useSkillStore.getState(), Q = usePanelStore.getState();
    await Promise.all([P.loaded || P.loadPersonas(), S.loaded || S.loadSkills(), Q.loaded || Q.loadPanels()]);
    if (!useAgentPersonaStore.getState().loaded || !useSkillStore.getState().loaded || !usePanelStore.getState().loaded) return null;
    const models = await loadModels();
    return {
      personas: useAgentPersonaStore.getState().personas.map((p) => p.name), skills: useSkillStore.getState().skills.map((k) => k.commandName),
      panels: usePanelStore.getState().panels.map((p) => p.name), models: models.fallback ? null : models.models.map((m) => m.id),
      boards: useTicketStore.getState().boards.map((b) => ({ id: b.id, name: b.name })),
    };
  }, []);
  const afterImport = useCallback((total: number, dropped: Dropped[], unsetCount: number) => {
    if (dropped.length || unsetCount) setImportReport({ total, dropped, unset: unsetCount });
    else toast.success(`Floor imported: ${total} machine${total === 1 ? '' : 's'}`);
  }, []);
  const importReplace = useCallback((read: Extract<ReadFloor, { ok: true }>) => {
    const l = useFactoryStore.getState().layout; if (!l) return;
    setImporting(null); setSelection(null); setTool('select');
    commit({ ...l, machines: read.machines });
    window.setTimeout(fit, 0);
    afterImport(read.machines.length, read.dropped, read.machines.filter((m) => setupGap(m)).length);
  }, [commit, fit, afterImport]);
  const importInHand = useCallback((read: Extract<ReadFloor, { ok: true }>) => {
    setImporting(null);
    const ms = read.machines, x0 = Math.min(...ms.map((m) => m.x)), y0 = Math.min(...ms.map((m) => m.y));
    const clip: Clip = { w: Math.max(...ms.map((m) => m.x + m.w)) - x0, h: Math.max(...ms.map((m) => m.y + m.h)) - y0, machines: ms.map((m) => ({ ...m, x: m.x - x0, y: m.y - y0 }) as MachineSpec) };
    placePlan(clip, 'imported', `${ms.length} machine${ms.length === 1 ? '' : 's'} imported: click on the floor where they should go. Escape puts them down; ${MOD}V picks them up again.`);
    pendingReport.current = { order: ms.map((m) => m.id), total: ms.length, dropped: read.dropped, unset: ms.filter((m) => setupGap(m)).length };
  }, [placePlan]);
  const onImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    const l = useFactoryStore.getState().layout;
    if (!f || !l) return;
    const known = await knownHere().catch(() => null);
    if (!known) { toast.error('Could not read the personas, skills and panels of this instance: nothing was imported'); return; }
    const read = readFloor(await f.text(), l.version ?? 1, known);
    if (!read.ok) { toast.error(read.error); return; }
    if (!read.machines.length) { toast.info('This floor has no machines'); return; }
    /* an empty floor (its Inbound zone at most) is replaced without asking */
    if (l.machines.every((m) => m.kind === 'zone' && m.inbound)) importReplace(read);
    else setImporting({ name: f.name, read });
  }, [knownHere, importReplace]);

  // The command card: the menu that fits what is selected and the mode, and the sub-menus opened in it.
  const [path, setPath] = useState<string[]>([]);
  const zoneNext = selMachine?.kind === 'zone' ? snapshot?.tickets.filter((t) => t.machineId === selMachine.id && !t.released).sort((a, b) => a.since.localeCompare(b.since))[0] ?? null : null;
  const gate = selTicket ? layout?.machines.find((q) => q.id === selTicket.machineId) : null;
  /* what the belts and arms of the selection can be made: fast when one of them is not yet, plain when all are */
  const beltSpeed = useMemo<'up' | 'down' | null>(() => {
    const ids = selMany.length > 1 ? new Set(selMany) : selMachine ? new Set([selMachine.id]) : null;
    const movers = ids && layout ? layout.machines.filter((m) => (m.kind === 'belt' || m.kind === 'arm') && ids.has(m.id)) : [];
    return movers.length === 0 ? null : movers.some((m) => (m.kind === 'belt' || m.kind === 'arm') && !m.fast) ? 'up' : 'down';
  }, [selMany, selMachine, layout]);
  const root = useMemo(() => factoryMenu({
    building, tool, dir, mod: MOD, many: selMany.length, undoable: store.undoable > 0, redoable: store.redoable > 0, hasClip,
    ticket: selTicket ? { phase: selTicket.phase, released: selTicket.released, favorite: selTicket.info ? selTicket.info.favorite : null, outcomes: gate?.kind === 'station' ? gate.outcomes : [], canAside: canSetAside(selTicket, gate), ...(selTicket.item ? { item: { url: selTicket.item.url } } : {}) } : null,
    waiting: needs.length, speed: beltSpeed, group,
    machine: selMachine ? { kind: selMachine.kind, waiting: !!zoneNext, popup: hasPopup(selMachine), power: selMachine.kind === 'station' && RUNS.includes(selMachine.exec) ? (selMachine.off ? 'off' : 'on') : null } : null,
    act: {
      build: () => { setBuilding(true); setSelection(null); },
      done: () => setBuilding(false),
      intake: () => setTransferOpen(true),
      /* at the desk selected, else at the floor's first desk, else in Inbound */
      newTicket: () => setDeskForm({ desk: selMachine?.kind === 'desk' ? selMachine : layout?.machines.find((m): m is DeskSpec => m.kind === 'desk') ?? null }),
      tickets: () => setListOpen(true),
      fit, plan: () => setPlanOpen(true), paste,
      exportFloor: downloadFloor, importFloor: () => fileRef.current?.click(),
      tool: (t) => setTool((cur) => (cur === t ? 'select' : t)),
      select: () => setTool('select'),
      back: () => { setPath((p) => p.slice(0, -1)); setTool('select'); },
      face: turnInHand,
      undo: () => void store.undo(), redo: () => void store.redo(),
      copy: () => copy(false), cut: () => copy(true),
      turn: () => { const l = useFactoryStore.getState().layout; if (l && selMachine) commit(rotate(l, selMachine.id)); },
      remove: () => {
        const l = useFactoryStore.getState().layout;
        if (selMany.length > 1) { if (l) commit(eraseMany(l, new Set(selMany))); setSelection(null); }
        else if (selMachine) removeMachine(selMachine.id);
      },
      deselect: () => setSelection(null),
      openTicket: () => { if (selTicket) setOpenTicket(selTicket.ticketId); },
      star: () => {
        /* an item is not a ticket: it has no star */
        if (group) { for (const t of selTickets) if (t.info && !t.item && t.info.favorite === group.starred) void store.star(t.ticketId, !group.starred); }
        else if (selTicket?.info && !selTicket.item) void store.star(selTicket.ticketId, !selTicket.info.favorite);
      },
      /* one ticket leaves at once; several are asked about first */
      openSource: () => { if (selTicket?.item?.url) window.open(selTicket.item.url, '_blank', 'noopener'); },
      archive: () => { if (selTicket?.item) { void store.archiveItem(selTicket.ticketId); setSelection(null); } },
      newItem: () => { if (selMachine?.kind === 'intake') setNewItemAt(selMachine.id); },
      giveBack: () => { if (group) setConfirmGive(true); else if (selTicket) { void store.giveBack(selTicket.ticketId); setSelection(null); } },
      resolve: (o) => { if (selTicket) void store.resolve(selTicket.ticketId, o); },
      release: () => { if (group) { for (const t of selTickets) if (t.phase === 'zone' && !t.released) void store.release(t.ticketId); } else if (selTicket) void store.release(selTicket.ticketId); },
      retry: () => { if (group) { for (const t of selTickets) if (t.phase === 'failed' || t.phase === 'aside') void store.putBack(t.ticketId); } else if (selTicket) void store.putBack(selTicket.ticketId); },
      setAside: () => {
        if (group) { const byId = new Map((layout?.machines ?? []).map((m) => [m.id, m])); for (const t of selTickets) if (canSetAside(t, t.machineId ? byId.get(t.machineId) : null)) void store.setAside(t.ticketId); }
        else if (selTicket) void store.setAside(selTicket.ticketId);
      },
      putBack: (o) => { if (selTicket) void store.putBack(selTicket.ticketId, o); },
      openMachine: () => { if (selMachine && hasPopup(selMachine)) setOpenMachine(selMachine.id); },
      power: () => { if (selMachine?.kind === 'station') void store.power(selMachine.id, !!selMachine.off); },
      floor: () => setFloorOpen(true),
      limits: () => setLimitsOpen(true),
      viewExit: () => { if (selMachine?.kind === 'exit') setExitLog({ machineId: selMachine.id }); },
      exits: () => setExitLog({ machineId: null }),
      archived: () => setArchived({ intakeId: null }),
      archivedHere: () => { if (selMachine?.kind === 'intake') setArchived({ intakeId: selMachine.id }); },
      next: () => stepWaiting(1),
      speed: () => { const l = useFactoryStore.getState().layout; if (l && beltSpeed) commit(setSpeed(l, new Set(selMany.length > 1 ? selMany : selMachine ? [selMachine.id] : []), beltSpeed === 'up')); },
      releaseNext: () => { if (zoneNext) void store.release(zoneNext.ticketId); },
    },
  }), [building, tool, dir, selMany, selTicket, selMachine, gate, zoneNext, hasClip, store, fit, paste, copy, commit, removeMachine, needs.length, stepWaiting, beltSpeed, group, selTickets, layout, downloadFloor]);
  const card = useMemo(() => menuAt(root, path), [root, path]);
  /* a sub-menu belongs to what was on screen when it was opened: selecting something, or leaving build mode, closes it */
  const selKind = selection ? Object.keys(selection)[0] : '';
  useEffect(() => { setPath([]); }, [building, selKind]);
  /* out of build mode an area is decor: it does not stay selected */
  useEffect(() => { if (!building && selMachine?.kind === 'area') setSelection(null); }, [building, selMachine]);
  /* where the card is, from the floor down: Factory › Build › Move */
  const trail = useMemo(() => [...(root.title === 'Factory' ? [] : ['Factory']), ...(building && root.title !== 'Build' ? ['Build'] : []), ...card.titles], [root.title, building, card.titles]);
  const runCommand = useCallback((c: Command) => {
    if (c.disabled) return;
    c.run?.();
    if (c.menu) setPath([...card.path, c.id]);
  }, [card.path]);

  // Saved selections, RTS style: Shift+1…9 and Shift+0 save; the digit alone selects, and pressed again on what is already selected it centres the view on it.
  const onGroup = useCallback((i: number, save: boolean) => {
    if (save) {
      const cur = live.current.selection;
      if (!cur) { toast.info('Select a machine or a ticket first'); return; }
      const next = groupsRef.current.map((x, k) => (k === i ? cur : x));
      setGroups(next);
      void useFactoryStore.getState().setSettings({ groups: next });
      return;
    }
    const g = groupsRef.current[i], s = useFactoryStore.getState(), v = viewRef.current;
    if (!g || !v) return;
    /* as in a strategy game: the key selects, and pressed again on what is already selected it goes there */
    if (!sameSelection(g, live.current.selection)) { setSelection(g); return; }
    const at = [...ticketIds(g).map((id) => v.ticketPos(id)), ...machineIds(g).map((id) => { const m = s.layout?.machines.find((q) => q.id === id); return m ? { x: m.x + m.w / 2, y: m.y + m.h / 2 } : null; })].filter((p): p is { x: number; y: number } => !!p);
    /* the middle of what it holds: several things are framed around their centre */
    if (at.length) { v.cam.x = (Math.min(...at.map((p) => p.x)) + Math.max(...at.map((p) => p.x))) / 2; v.cam.y = (Math.min(...at.map((p) => p.y)) + Math.max(...at.map((p) => p.y))) / 2; }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      /* a dialog is open (a ticket, a machine, the instructions editor…): the floor's keys are not for it */
      if (transferOpen || deskForm || openItem || newItemAt || openTicket || openMachine || exitLog || archived || archivedItem || floorOpen || limitsOpen || talkOpen || document.querySelector('[data-overlay-top]')) return;
      /* Tab opens the list of the tickets on the floor; in the list, Tab closes it */
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setListOpen(true); return; }
      /* Ctrl/Cmd+Z takes back the last change to the floor, with Shift it puts it back: in build mode only */
      const chord = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey ? e.key.toLowerCase() : '';
      if (live.current.building && (chord === 'c' || chord === 'x' || chord === 'v')) {
        e.preventDefault();
        if (chord === 'v') paste(); else copy(chord === 'x');
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setFiltersOpen(true); window.setTimeout(() => { findRef.current?.focus(); findRef.current?.select(); }, 0); return; }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'z' && live.current.building) {
        e.preventDefault(); setSelection(null);
        void (e.shiftKey ? useFactoryStore.getState().redo() : useFactoryStore.getState().undo());
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') { e.preventDefault(); live.current.space = true; if (canvasRef.current && !press.current) canvasRef.current.style.cursor = 'grab'; return; }
      /* N goes to the next ticket that waits for someone, Shift+N to the one before: the arrows only ever move the view */
      /* U puts the console away and brings it back, in any mode */
      if (e.code === 'KeyU') { e.preventDefault(); flipHud(); return; }
      if (e.code === 'KeyN' && !live.current.building) { e.preventDefault(); stepWaiting(e.shiftKey ? -1 : 1); return; }
      /* Enter talks: to the ticket selected, or, with nothing selected, to whoever was talked to last; an item opens */
      if (e.key === 'Enter' && selTicket?.item && !live.current.building) { e.preventDefault(); setOpenTicket(selTicket.ticketId); return; }
      if (e.key === 'Enter' && !live.current.building && (selTicket || !selMachine)) { e.preventDefault(); setTalkOpen(true); return; }
      if (e.key === 'Enter' && selMachine?.kind === 'exit' && !building) { e.preventDefault(); setExitLog({ machineId: selMachine.id }); return; }
      if (e.key === 'Enter' && selMachine && hasPopup(selMachine)) { e.preventDefault(); setOpenMachine(selMachine.id); return; }
      if (e.key === 'Escape' && peekFor.current) { e.preventDefault(); setPeekOpen(false); return; }
      const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (arrow && viewRef.current) { e.preventDefault(); viewRef.current.cam.x += arrow[0]! * 3; viewRef.current.cam.y += arrow[1]! * 3; return; }
      const digit = /^Digit([0-9])$/.exec(e.code);
      if (digit) { e.preventDefault(); onGroup((Number(digit[1]) + GROUPS - 1) % GROUPS, e.shiftKey); return; }
      /* the card's keys: the one of a command's place on the keyboard, whatever it types; then the named keys (Escape, Delete) */
      const slot = slotOfCode(e.code), key = e.key === 'Backspace' ? 'Delete' : e.key;
      const cmd = (slot >= 0 ? card.menu.slots[slot] : null) ?? byKey(card.menu, key);
      if (cmd) { e.preventDefault(); if (!cmd.disabled) runCommand(cmd); }
      else if (key === 'Escape' && selection) setSelection(null);
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') { live.current.space = false; if (canvasRef.current && !press.current) canvasRef.current.style.cursor = ''; } };
    /* a key released while the window is elsewhere never says so: let go of it */
    const onBlur = () => { live.current.space = false; };
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', onBlur);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur); };
  }, [card, runCommand, fit, selection, transferOpen, deskForm, openItem, newItemAt, openTicket, openMachine, exitLog, archived, archivedItem, building, floorOpen, limitsOpen, flipHud, onGroup, copy, paste, selTicket, selMachine, stepWaiting, talkOpen]);

  /* another skin chosen while the page is open, or its decor switched: the floor is painted with it from the next frame */
  const skinShown = useRef(skinKey);
  useEffect(() => { if (skinShown.current !== skinKey) { skinShown.current = skinKey; viewRef.current?.setSkin(makeSkin()); } }, [skinKey, makeSkin]);

  const halted = snapshot?.floor.settings.halted === true;
  const toolHint = building && tool !== 'select' ? TOOLS.find((t) => t[0] === tool)?.[3] : null;
  return (
    <div ref={rootRef} className="factory-page flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-bg-base)]" data-skin={skin.id} style={chromeStyle}>
      <style>{EDGE_CSS}</style>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <canvas
            ref={canvasRef} className={cn('absolute inset-0 h-full w-full touch-none', building && tool !== 'select' && 'cursor-crosshair')}
            aria-label="Factory floor" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            onPointerLeave={() => { live.current.hover = null; live.current.hoverLamp = null; live.current.ghost = null; tipRef.current?.hide(); lampTipRef.current?.hide(); }} onWheel={onWheel} onDoubleClick={onDoubleClick} onContextMenu={(e) => e.preventDefault()}
          />
          {/* the console casts a shadow on the floor along its contour; the build tape lies over it */}
          {!hudHidden && <FactoryHudShadow hud={HUD} light={chrome ? chrome.light : undefined} />}
          {/* build mode says so all round the view: tape, and a plate in its corner */}
          {(building || halted) && <FactoryBuildFrame halted={halted} building={building} hud={hudHidden ? null : HUD} />}
          {snapshot && <FactoryCounters c={{
            tickets: snapshot.tickets.filter((t) => !t.item).length, items: snapshot.tickets.filter((t) => t.item).length,
            running: snapshot.running, maxRunning: snapshot.floor.settings.maxConcurrentRuns, runsHour: snapshot.runsLastHour, maxRunsHour: snapshot.floor.settings.maxRunsPerHour,
            waiting: needs.length + unset.length,
          }} />}
          <FactoryTicketTip ref={tipRef} />
          <FactoryLampTip ref={lampTipRef} />
          {!building && needs.length + unset.length > 0 && <FactoryNeeds needs={needs} unset={unset} selected={selTicket?.ticketId ?? selMachine?.id ?? null} onPick={pickNeed} onOpen={setOpenTicket} onPickMachine={(id) => (selMachine?.id === id ? setOpenMachine(id) : showMachine(id))} />}
          {peekFor.current && selTicket?.item && <FactoryItemPeek ref={peekRef} key={peekFor.current} itemId={peekFor.current} onOpen={() => setOpenItem(peekFor.current)} onClose={() => setPeekOpen(false)} />}
          {peekFor.current && !selTicket?.item && <FactoryPeek ref={peekRef} key={peekFor.current} ticketId={peekFor.current} onOpen={() => setOpenTicket(peekFor.current)} onClose={() => setPeekOpen(false)} onPopOut={(executionId, title) => setRunLog({ executionId, title })} />}
          {runLog && <FloatingExecutionPanel key={runLog.executionId} executionId={runLog.executionId} title={runLog.title} onClose={() => setRunLog(null)} />}
          {halted && (
            <div className={cn('absolute inset-x-3 top-3 z-10 mx-auto flex max-w-2xl items-center gap-3 rounded-lg px-3 py-2 text-xs shadow-lg', tint('red'))} role="alert">
              <span className="min-w-0 flex-1"><b>Emergency stop.</b> Nothing moves and nothing runs. The runs that were cut start again when the floor restarts. You can still move tickets and build.</span>
              <Button size="sm" variant="primary" onClick={() => void store.halt(false)}>Restart the floor</Button>
            </div>
          )}
          {snapshot?.notice && !halted && (
            <div className={cn('absolute inset-x-3 top-3 z-10 mx-auto flex max-w-3xl items-start gap-3 rounded-lg px-3 py-2 text-xs shadow-lg', tint('yellow'))} role="status">
              <span className="min-w-0 flex-1">{snapshot.notice}</span>
              <Button size="sm" onClick={() => void store.ackNotice()}>Got it</Button>
            </div>
          )}
          {layer && !building && (
            <div className={cn('absolute top-3 flex max-w-[min(560px,calc(100%-24px))] items-center gap-2 rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2.5 py-1.5 shadow-lg', needs.length + unset.length ? 'left-[292px]' : 'left-3')} role="status">
              <span className="flex-none text-xs font-semibold text-[var(--theme-text-primary)]">{LENS_LABEL[layer.kind]}</span>
              <span className="min-w-0 flex-1 text-[11px] text-[var(--theme-text-secondary)]">{layer.legend}{layer.kind !== 'load' && stats && layer.values.size === 0 ? ' — nothing to show yet.' : ''}</span>
              <Button size="sm" variant="ghost" onClick={() => setLens('none')}>Off</Button>
            </div>
          )}
          {layout && layout.machines.length <= 1 && !building && snapshot && snapshot.tickets.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="pointer-events-auto max-w-sm rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4 text-center">
                <div className="text-sm font-semibold text-[var(--theme-text-primary)]">The floor is empty</div>
                <p className="mt-1 text-xs text-[var(--theme-text-muted)]">Build belts, arms and stations, then hand tickets over: they land in the Inbound zone, and you drag them onto the floor to start them.</p>
                <div className="mt-3"><Button variant="primary" size="sm" onClick={() => setBuilding(true)}>Build</Button></div>
              </div>
            </div>
          )}
        </div>
      </div>
      <FactoryConsole view={view} snapshot={snapshot} layout={layout} selection={selection} onSelect={setSelection} menu={card.menu} trail={trail} onRun={runCommand} groups={groups} onGroup={onGroup} miniRef={miniRef} lens={lens} onLens={setLens} onFit={fit} show={show} onShow={flipShow} hidden={hudHidden} building={building}
        tab={snapshot && <FiltersTab finder={finder} found={found} total={snapshot.tickets.length} open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} tabRef={filters.refs.setReference} tabProps={filters.getReferenceProps()} />}
        strip={<ConsoleStrip halted={halted} onHalt={(on) => void store.halt(on)} hidden={hudHidden} onHide={flipHud} />}
        title={building ? 'Build' : 'Factory floor'}
        hint={toolHint ?? (building ? 'Pick a machine to place, or double-click one to set it up. Drag on empty floor to select several, Shift adds to the selection; then drag one of them to move them all. Space+drag, the arrow keys or the edges of the page move the view.' : 'Click to select, drag a ticket to move it, double-click a ticket or a machine to open it, drag on the floor to select several tickets, Shift adds to the selection. Space+drag, the arrow keys or the edges of the page move the view. Tab lists the tickets, hovering one shows what it is, / finds one.')} />
      {/* a ticket opened from a machine's window covers it: closing the ticket brings the window back */}
      {openMachine && !openTicket && view && <FactoryMachinePopup machineId={openMachine} view={view} onClose={closeMachine} onPatch={patchMachine} onRemove={removeMachine} onOpenTicket={setOpenTicket} onOpenMachine={openMachineOn} onNewItem={setNewItemAt} />}
      {exitLog && !openTicket && <FactoryExitLog machineId={exitLog.machineId} onClose={() => setExitLog(null)} onOpenTicket={setOpenTicket}
        onSettings={exitLog.machineId ? () => { const id = exitLog.machineId!; setExitLog(null); setOpenMachine(id); } : undefined} />}
      {archived && !archivedItem && <FactoryArchivedItems intakeId={archived.intakeId} onClose={() => setArchived(null)} onOpenItem={setArchivedItem} />}
      {archivedItem && <FactoryArchivedItemPopup itemId={archivedItem} onClose={() => setArchivedItem(null)} />}
      {floorOpen && <FactoryFloorPopup onClose={() => setFloorOpen(false)} onGoTo={showMachine} />}
      {limitsOpen && <FactoryLimitsPopup onClose={() => setLimitsOpen(false)} />}
      {openTicket && <FactoryWorkbench ticketId={openTicket} needs={needs} tickets={snapshot?.tickets ?? []} onNavigate={openOn} onClose={closeTicket} />}
      {talkOpen && <FactoryTalk ticket={talkTicket} others={talkOthers} onClose={() => setTalkOpen(false)} onOpenTicket={(id) => { setTalkOpen(false); setOpenTicket(id); }}
        style={hudHidden ? { left: '50%', bottom: 44, width: 'min(640px, calc(100% - 32px))', transform: 'translateX(-50%)', position: 'fixed' } : { left: '50%', bottom: HUD.mid + 30, width: `min(640px, calc(100% - ${HUD.left + HUD.right + 32}px))`, transform: 'translateX(-50%)', position: 'fixed' }} />}
      {filtersOpen && snapshot && (
        <FloatingPortal>
          <div ref={filters.refs.setFloating} style={filters.floatingStyles} {...filters.getFloatingProps()} aria-label="Filters"
            className="z-[60] rounded-xl border border-[var(--theme-border-input)] bg-[color-mix(in_srgb,var(--theme-bg-surface)_94%,transparent)] p-3 shadow-2xl">
            <FactoryFinder finder={finder} onChange={setFinder} tickets={snapshot.tickets} found={found} onJump={jump} inputRef={findRef} onClose={() => setFiltersOpen(false)} />
          </div>
        </FloatingPortal>
      )}
      {planOpen && <FactoryPlanModal onPlace={placePlan} onClose={() => setPlanOpen(false)} />}
      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" aria-label="Floor file to import" onChange={(e) => void onImportFile(e)} />
      {importing && <FloorImportChoice name={importing.name} incoming={importing.read.machines.length} here={layout?.machines.length ?? 0}
        onReplace={() => importReplace(importing.read)} onHand={() => importInHand(importing.read)} onClose={() => setImporting(null)} />}
      {importReport && <FloorImportReport {...importReport} onGo={(id) => { setImportReport(null); showMachine(id); }} onClose={() => setImportReport(null)} />}
      {listOpen && !openTicket && <FactoryTicketsModal finder={finder} onFinder={setFinder} onClose={() => setListOpen(false)}
        onGoTo={(id) => { setListOpen(false); setBuilding(false); goTo(id); }} onDetail={(id) => { setListOpen(false); setOpenTicket(id); }} />}
      <ConfirmModal open={confirmGive} title={`Give ${selTickets.length} tickets back?`} confirmLabel="Give back" danger={false}
        message="They leave the Factory and keep their status. Their place on the floor is lost: handed over again, they land in Inbound."
        onCancel={() => setConfirmGive(false)}
        onConfirm={() => { setConfirmGive(false); for (const t of selTickets) void store.giveBack(t.ticketId); setSelection(null); }} />
      <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} onPick={transferTo} />
      {openItem && <FactoryItemPopup itemId={openItem} onClose={() => setOpenItem(null)} />}
      {newItemAt && <FactoryNewItem intakeId={newItemAt} onClose={() => setNewItemAt(null)} />}
      {deskForm && <FactoryDeskForm desk={deskForm.desk} onClose={() => setDeskForm(undefined)} onOpenTicket={setOpenTicket} />}
    </div>
  );
}
