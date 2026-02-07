import { memo, useRef } from 'react';
import { useTerminal } from '../../hooks/useTerminal';

interface Props {
  sessionId: string;
}

export const TerminalView = memo(function TerminalView({ sessionId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  useTerminal(sessionId, containerRef);

  return (
    <div
      ref={containerRef}
      className="xterm-container flex-1"
    />
  );
});
