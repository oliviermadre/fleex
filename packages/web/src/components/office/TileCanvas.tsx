import { memo, useRef, useEffect } from 'react';
import type { TileLayer } from './types';
import { TILE_SIZE, DISPLAY_SCALE } from './types';
import { TILE_COLORS } from './assetRegistry';

interface TileCanvasProps {
  layers: TileLayer[];
  widthTiles: number;
  heightTiles: number;
}

/**
 * Renders static floor/wall tiles to a canvas at native 16px resolution,
 * then CSS-scales to display size with image-rendering: pixelated.
 */
export const TileCanvas = memo(function TileCanvas({
  layers,
  widthTiles,
  heightTiles,
}: TileCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Native resolution (16px per tile)
    const nativeW = widthTiles * TILE_SIZE;
    const nativeH = heightTiles * TILE_SIZE;
    canvas.width = nativeW;
    canvas.height = nativeH;

    // Clear
    ctx.clearRect(0, 0, nativeW, nativeH);

    // Draw each layer
    for (const layer of layers) {
      for (let y = 0; y < layer.height; y++) {
        for (let x = 0; x < layer.width; x++) {
          const tileId = layer.tiles[y]?.[x];
          if (!tileId) continue;

          const color = TILE_COLORS[tileId];
          if (!color) continue;

          ctx.fillStyle = color;
          ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

          // Add subtle grid lines for floor tiles
          if (tileId === 'floor' || tileId === 'floor-lobby' || tileId === 'corridor') {
            ctx.strokeStyle = 'rgba(0,0,0,0.06)';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(
              x * TILE_SIZE + 0.5,
              y * TILE_SIZE + 0.5,
              TILE_SIZE - 1,
              TILE_SIZE - 1,
            );
          }

          // Add highlight for wall tops
          if (tileId === 'wall-top') {
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, 2);
          }
        }
      }
    }
  }, [layers, widthTiles, heightTiles]);

  // CSS scales the canvas up with pixelated rendering
  const displayW = widthTiles * TILE_SIZE * DISPLAY_SCALE;
  const displayH = heightTiles * TILE_SIZE * DISPLAY_SCALE;

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: displayW,
        height: displayH,
        imageRendering: 'pixelated',
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
      }}
    />
  );
});
