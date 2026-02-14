import { memo } from 'react';
import type { OfficeObjectType } from './types';
import { TILE_PX } from './types';
import { PLACEHOLDER_ASSETS } from './assetRegistry';

interface PlaceholderSpriteProps {
  type: OfficeObjectType;
  /** Override asset key (e.g. 'robot-working' instead of 'robot') */
  assetKey?: string;
  tileW: number;
  tileH: number;
  label?: string;
  /** True when desk has no worktree assigned */
  empty?: boolean;
}

/** CSS placeholder sprite: colored rect + emoji + optional label */
export const PlaceholderSprite = memo(function PlaceholderSprite({
  type,
  assetKey,
  tileW,
  tileH,
  label,
  empty,
}: PlaceholderSpriteProps) {
  const resolvedKey = empty && type === 'desk' ? 'desk-empty' : (assetKey ?? type);
  const asset = PLACEHOLDER_ASSETS[resolvedKey] ?? PLACEHOLDER_ASSETS[type];
  if (!asset) return null;

  const w = tileW * TILE_PX;
  const h = tileH * TILE_PX;

  // Signs with a label render as a text nameplate
  if (type === 'sign' && label) {
    return (
      <div
        style={{
          width: w,
          height: h,
          backgroundColor: asset.bgColor,
          border: `1.5px solid ${asset.borderColor}`,
          borderRadius: 3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          imageRendering: 'pixelated',
          boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: asset.label ? undefined : '#5c3d1e',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: w - 8,
            textAlign: 'center',
            lineHeight: 1,
            letterSpacing: 0.3,
          }}
        >
          {label}
        </span>
      </div>
    );
  }

  const isEmptyDesk = empty && type === 'desk';

  return (
    <div
      style={{
        width: w,
        height: h,
        backgroundColor: asset.bgColor,
        border: `2px ${isEmptyDesk ? 'dashed' : 'solid'} ${asset.borderColor}`,
        borderRadius: type === 'robot' ? '50%' : 4,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        overflow: 'hidden',
        imageRendering: 'pixelated',
        opacity: isEmptyDesk ? 0.4 : 1,
      }}
    >
      <span style={{ fontSize: Math.min(w, h) * 0.5, lineHeight: 1 }}>
        {asset.emoji}
      </span>
      {label && (
        <span
          style={{
            fontSize: 9,
            color: '#fff',
            textShadow: '0 1px 2px rgba(0,0,0,0.8)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: w - 4,
            textAlign: 'center',
            lineHeight: 1,
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
});
