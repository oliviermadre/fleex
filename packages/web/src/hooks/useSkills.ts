import { useEffect } from 'react';
import type { SkillWsMessage } from '@fleex/shared';
import { appWs } from '../services/websocket';
import { useSkillStore } from '../stores/skillStore';

export function useSkills() {
  const loadSkills = useSkillStore((s) => s.loadSkills);
  const handleWsMessage = useSkillStore((s) => s.handleWsMessage);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    const unsub = appWs.onChannel('skills', (msg) => {
      handleWsMessage(msg as SkillWsMessage);
    });

    return () => {
      unsub();
    };
  }, [handleWsMessage]);
}
