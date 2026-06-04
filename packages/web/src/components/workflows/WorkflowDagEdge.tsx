import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

/**
 * Custom edge for the workflow DAG (editor + runtime).
 *
 * Why this exists: when an edge goes "backward" (target node sits left of or
 * directly above/below the source — the typical `reject → previous step` case),
 * React Flow's default bezier between the source's right handle and the target's
 * left handle collapses into a tiny S-curve that's barely distinguishable from
 * a straight line, especially when both nodes are on the same horizontal row.
 *
 * We detect that case (`targetX <= sourceX`) and route the edge through a
 * cubic bezier with control points pushed well above the row, producing a
 * clear loop-back arch. Arc height and horizontal flare scale with the
 * span so the curve stays proportionate over short and long back-edges alike.
 */
export function WorkflowDagEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
    markerEnd,
    label,
  } = props;

  const isBackward = targetX <= sourceX;

  let edgePath: string;
  let labelX: number;
  let labelY: number;

  if (isBackward) {
    const span = Math.max(Math.abs(targetX - sourceX), 120);
    // Apex height above the row. Scales with span so a back-edge spanning
    // 5 nodes flies higher than one spanning 1, but caps so it doesn't
    // shoot off-screen on extreme layouts.
    const arcHeight = Math.min(Math.max(120, span * 0.35), 320);
    // `leadIn` = how far east the curve travels horizontally before
    // starting to climb. Bigger value → clearer horizontal exit/entry at
    // the source/target nodes. Capped so the curve doesn't overshoot the
    // node it's attached to by too much.
    const leadIn = Math.min(Math.max(60, span * 0.12), 130);
    // `shoulder` = horizontal length the curve maintains at the apex
    // before descending. Bigger value → flatter top of the arch (smoother
    // joint between the two halves). Scales with arcHeight so the joint
    // stays G1-continuous across all arch sizes.
    const shoulder = Math.min(Math.max(70, arcHeight * 0.55), 200);
    const apexX = (sourceX + targetX) / 2;
    const apexY = Math.min(sourceY, targetY) - arcHeight;

    // Chain two cubic beziers, meeting at the apex with horizontal tangents
    // on both sides. This gives a purely horizontal exit at the source,
    // a flat top, and a purely horizontal entry at the target — instead
    // of the steep diagonals a single cubic produces.
    edgePath =
      `M ${sourceX} ${sourceY}` +
      ` C ${sourceX + leadIn} ${sourceY}, ${apexX + shoulder} ${apexY}, ${apexX} ${apexY}` +
      ` C ${apexX - shoulder} ${apexY}, ${targetX - leadIn} ${targetY}, ${targetX} ${targetY}`;
    // Place the label on the apex itself — the curve is locally horizontal
    // there, so a pill-shaped label sits cleanly across the line instead
    // of floating in empty space above it.
    labelX = apexX;
    labelY = apexY;
  } else {
    const [p, lx, ly] = getBezierPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
    });
    edgePath = p;
    labelX = lx;
    labelY = ly;
  }

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
              background: 'var(--theme-bg-overlay, #27272a)',
              padding: '2px 6px',
              borderRadius: 4,
              fontSize: 11,
              lineHeight: 1.2,
              color: 'var(--theme-text-secondary, #d4d4d8)',
              border: '1px solid var(--theme-border, #27272a)',
              whiteSpace: 'nowrap',
            }}
            className="nodrag nopan"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
