import { memo } from 'react';
import type { OfficeObjectType } from './types';
import { PlaceholderSprite } from './PlaceholderSprite';

interface ObjectSpriteProps {
  type: OfficeObjectType;
  assetKey?: string;
  tileW: number;
  tileH: number;
  label?: string;
  empty?: boolean;
}

/**
 * Switches between PlaceholderSprite and SpritesheetSprite based on asset mode.
 * Currently always uses placeholder mode.
 */
export const ObjectSprite = memo(function ObjectSprite(props: ObjectSpriteProps) {
  // For now, always use placeholder sprites
  return <PlaceholderSprite {...props} />;
});
