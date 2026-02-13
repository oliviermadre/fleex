import { memo } from 'react';
import { ZERG } from './rtsTheme';

interface CreepTextureProps {
  x: number;
  y: number;
  radius: number;
  variant?: 'base' | 'nydus';
}

export const CreepTexture = memo(function CreepTexture({ x, y, radius, variant = 'base' }: CreepTextureProps) {
  const color = variant === 'nydus' ? ZERG.nydusGlow : ZERG.creepGlow;
  const midColor = variant === 'nydus' ? 'rgba(200, 100, 255, 0.15)' : 'rgba(45, 20, 82, 0.5)';

  return (
    <div
      style={{
        position: 'absolute',
        left: x - radius,
        top: y - radius,
        width: radius * 2,
        height: radius * 2,
        borderRadius: '50%',
        background: `radial-gradient(ellipse at center, ${midColor} 0%, ${color} 40%, transparent 70%)`,
        animation: 'rts-creep-pulse 4s ease-in-out infinite',
        pointerEvents: 'none',
      }}
    />
  );
});
