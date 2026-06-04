import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, ReactFlowProvider, useReactFlow,
  applyNodeChanges, applyEdgeChanges, addEdge,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange,
  MarkerType, Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ExecutorPalette } from './executor-palette';
import { EditorStepNode, type EditorStepNodeData } from './EditorStepNode';
import { StepConfigPanel } from './StepConfigPanel';
import { EdgeConfigPanel } from './EdgeConfigPanel';
import { WorkflowDagEdge } from './WorkflowDagEdge';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { useActiveTheme, useColorMode } from '../../hooks/useActiveTheme';
import type { WorkflowExecutorType, WorkflowStep, WorkflowEdge as WfEdge, WorkflowTemplate } from '@fleex/shared';

const nodeTypes = { editorStep: EditorStepNode };
const edgeTypes = { workflow: WorkflowDagEdge };

interface Props {
  template: WorkflowTemplate;
  onBack: () => void;
}

export function WorkflowEditorView(props: Props) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  );
}

function EditorInner({ template, onBack }: Props) {
  const update = useWorkflowTemplateStore((s) => s.update);
  const reactFlow = useReactFlow();
  const colorMode = useColorMode();
  const themeColors = useActiveTheme().colors;
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Local mutable state
  const [name, setName] = useState(template.name);
  const [slug, setSlug] = useState(template.slug);
  const [emoji, setEmoji] = useState(template.emoji);
  const [description, setDescription] = useState(template.description);
  const [steps, setSteps] = useState<WorkflowStep[]>(template.steps);
  const [edges, setEdges] = useState<WfEdge[]>(template.edges);
  const [entryStepId, setEntryStepId] = useState<string>(template.entryStepId);

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ReactFlow node and edge derivation
  // NOTE: `width/height` (NOT `initialWidth/initialHeight`) make the inline size
  // persist after the first render — `initialWidth` is dropped from the inline
  // style once `handleBounds` is defined, which would let the node expand to
  // fill the canvas.
  // NOTE: `handles` are declared explicitly. Without them, React Flow's
  // `parseHandles(userNode, internalNode)` returns `undefined` every time
  // `useMemo` produces a fresh userNode reference (which happens on every
  // selection/hover state change). That wipes `internals.handleBounds`, which
  // in turn makes `isNodeInitialized()` return false and `getEdgePosition()`
  // return null — so no edge SVG is ever painted AND connection drags abort
  // immediately because `getHandle()` can't find a `fromHandleInternal`.
  // Declaring handles statically keeps `handleBounds` populated across re-renders.
  const nodes: Node[] = useMemo(() => steps.map((s) => ({
    id: s.id,
    type: 'editorStep',
    position: s.position,
    width: 180,
    height: 80,
    handles: [
      { id: null, type: 'target' as const, position: Position.Left, x: 0, y: 40, width: 1, height: 1 },
      { id: null, type: 'source' as const, position: Position.Right, x: 180, y: 40, width: 1, height: 1 },
    ],
    data: {
      step: s, isSelected: s.id === selectedStepId, isEntry: s.id === entryStepId,
      onSelect: (id: string) => { setSelectedStepId(id); setSelectedEdgeId(null); },
      onDelete: (id: string) => {
        setSteps((prev) => prev.filter((x) => x.id !== id));
        setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
        if (selectedStepId === id) setSelectedStepId(null);
        if (entryStepId === id) {
          const next = steps.find((x) => x.id !== id);
          if (next) setEntryStepId(next.id);
        }
      },
    } as unknown as Record<string, unknown>,  // ReactFlow node data type quirk
  })), [steps, selectedStepId, entryStepId]);

  const rfEdges: Edge[] = useMemo(() => edges.map((e) => ({
    id: e.id, source: e.source, target: e.target,
    type: 'workflow',
    label: e.label ?? (e.condition ? `${e.condition.field} ${e.condition.operator} ${String(e.condition.value)}` : ''),
    style: { strokeDasharray: e.isDefault ? undefined : '5,5' },
    markerEnd: { type: MarkerType.ArrowClosed },
    selected: e.id === selectedEdgeId,
  })), [edges, selectedEdgeId]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // Capture position changes back to our local state
    setSteps((prev) => {
      const indexed = new Map(prev.map((s) => [s.id, s] as const));
      for (const c of changes) {
        if (c.type === 'position' && c.position) {
          const cur = indexed.get(c.id);
          if (cur) indexed.set(c.id, { ...cur, position: c.position });
        }
      }
      return Array.from(indexed.values());
    });
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((prev) => {
      let next = prev;
      for (const c of changes) {
        if (c.type === 'remove') next = next.filter((e) => e.id !== c.id);
      }
      return next;
    });
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    const id = `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setEdges((prev) => [...prev, { id, source: connection.source!, target: connection.target!, isDefault: true }]);
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/x-fleex-executor') as WorkflowExecutorType;
    if (!type) return;
    // screenToFlowPosition expects raw screen coords (clientX/clientY), not wrapper-relative
    const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const step: WorkflowStep = {
      id, name: type === 'human_gate' ? 'Human Gate' : 'New Step',
      executorType: type, executorRef: '', position,
      humanGateOutcomes: type === 'human_gate' ? ['approve', 'reject'] : undefined,
    };
    setSteps((prev) => [...prev, step]);
    if (steps.length === 0) setEntryStepId(id);
  }, [reactFlow, steps.length]);

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const onPaletteDragStart = useCallback((type: WorkflowExecutorType, e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-fleex-executor', type);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const selectedStep = selectedStepId ? steps.find((s) => s.id === selectedStepId) : undefined;
  const selectedEdge = selectedEdgeId ? edges.find((e) => e.id === selectedEdgeId) : undefined;

  const save = async () => {
    setSaving(true); setError(null);
    try {
      await update(template.id, { name, slug, emoji, description, steps, edges, entryStepId, enabled: template.enabled });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full" style={{ color: 'var(--theme-text-primary)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--theme-border)' }}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-xs px-3 py-1 rounded border" style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}>← Back</button>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name"
            className="h-8 w-[200px] text-sm px-2 rounded border"
            style={{ background: 'var(--theme-bg-surface)', borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }} />
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="slug"
            className="h-8 w-[180px] text-xs font-mono px-2 rounded border"
            style={{ background: 'var(--theme-bg-surface)', borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }} />
          <input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🏭"
            className="h-8 w-[60px] text-center rounded border"
            style={{ background: 'var(--theme-bg-surface)', borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>{steps.length} steps · {edges.length} edges</span>
          <button
            onClick={() => reactFlow.fitView({ padding: 0.3, minZoom: 0.3, maxZoom: 1.2, duration: 300 })}
            className="text-xs px-3 py-1 rounded border"
            style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
            title="Fit all steps in view"
          >Fit view</button>
          <button
            onClick={() => {
              // Reset off-screen positions by re-laying out steps in a horizontal line
              setSteps((prev) => prev.map((s, i) => ({ ...s, position: { x: i * 240, y: 100 } })));
              setTimeout(() => reactFlow.fitView({ padding: 0.3, duration: 300 }), 50);
            }}
            className="text-xs px-3 py-1 rounded border"
            style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
            title="Reset positions (line up horizontally)"
          >Tidy</button>
          <button onClick={save} disabled={saving}
            className="text-xs px-3 py-1 rounded border disabled:opacity-50"
            style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}>{saving ? 'Saving…' : 'Save Workflow'}</button>
        </div>
      </div>
      {error && <div className="px-4 py-1 text-xs text-red-400">{error}</div>}

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <ExecutorPalette onDragStart={onPaletteDragStart} />
        <div ref={wrapperRef} className="flex-1" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            colorMode={colorMode}
            nodes={nodes} edges={rfEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onEdgeClick={(_, e) => { setSelectedEdgeId(e.id); setSelectedStepId(null); }}
            onPaneClick={() => { setSelectedStepId(null); setSelectedEdgeId(null); }}
            defaultViewport={{ x: 200, y: 100, zoom: 1 }}
            minZoom={0.2} maxZoom={2}
            fitView fitViewOptions={{ padding: 0.4, minZoom: 0.5, maxZoom: 1.2 }}
            defaultMarkerColor={themeColors.textMuted}
          >
            <Background gap={16} size={1} color={themeColors.borderSubtle} />
            <Controls className="!bg-[var(--theme-bg-surface)] !border-[var(--theme-border)]" showInteractive={false} />
            <MiniMap
              pannable zoomable
              maskColor={themeColors.bgHover}
              style={{ background: 'var(--theme-bg-surface)', border: '1px solid var(--theme-border)' }}
              nodeColor={themeColors.accentMuted}
              nodeStrokeColor={themeColors.accent}
            />
          </ReactFlow>
        </div>
        <div className="w-[320px] border-l p-4 overflow-y-auto" style={{ borderColor: 'var(--theme-border)' }}>
          {selectedStep ? (
            <StepConfigPanel
              step={selectedStep}
              isEntry={selectedStep.id === entryStepId}
              onChange={(next) => setSteps((prev) => prev.map((s) => s.id === next.id ? next : s))}
              onSetEntry={() => setEntryStepId(selectedStep.id)}
            />
          ) : selectedEdge ? (
            <EdgeConfigPanel
              edge={selectedEdge}
              onChange={(next) => setEdges((prev) => prev.map((e) => e.id === next.id ? next : e))}
              onDelete={() => { setEdges((prev) => prev.filter((e) => e.id !== selectedEdge.id)); setSelectedEdgeId(null); }}
            />
          ) : (
            <div className="space-y-3">
              <label className="block text-xs space-y-1">
                <span style={{ color: 'var(--theme-text-muted)' }}>Description</span>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                  className="w-full text-xs min-h-[80px] p-2 rounded border"
                  style={{ background: 'var(--theme-bg-surface)', borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }} />
              </label>
              <div className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
                Drag a step type from the palette into the canvas. Connect nodes by dragging from the right handle to the left handle of another node. Click a step or edge to configure it.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
