import { useEffect } from 'react';
import { WS_SKILL_PATH } from '@fleex/shared';
import type { SkillWsMessage } from '@fleex/shared';
import { skillWs } from '../services/websocket';
import { useSkillStore } from '../stores/skillStore';
import { WS_BASE_URL } from '../lib/constants';

export function useSkills() {
  const loadSkills = useSkillStore((s) => s.loadSkills);
  const handleWsMessage = useSkillStore((s) => s.handleWsMessage);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    skillWs.connect(`${WS_BASE_URL}${WS_SKILL_PATH}`);

    const unsub = skillWs.onMessage((buf) => {
      try {
        const text = new TextDecoder().decode(buf);
        const msg = JSON.parse(text) as SkillWsMessage;
        handleWsMessage(msg);
      } catch {
        // ignore non-JSON messages
      }
    });

    return () => {
      unsub();
      skillWs.disconnect();
    };
  }, [handleWsMessage]);
}
