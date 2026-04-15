import { useEffect, useCallback } from 'react';
import { DEFAULT_COLS, DEFAULT_ROWS, RESIZE_DEBOUNCE_MS, ServerMessageType } from '@fleex/shared';
import { terminalManager } from '../services/terminalManager';
import { appWs } from '../services/websocket';
import { useTerminalStore } from '../stores/terminalStore';

export function useTerminal(sessionId: string | null, containerRef: React.RefObject<HTMLElement | null>) {
  const setConnectionStatus = useTerminalStore((s) => s.setConnectionStatus);

  const handleResize = useCallback(() => {
    if (!sessionId) return;
    terminalManager.resize(sessionId);
    const instance = terminalManager.get(sessionId);
    if (instance) {
      appWs.sendResize(sessionId, instance.terminal.cols, instance.terminal.rows);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !containerRef.current) return;

    const container = containerRef.current;

    // Create terminal if not exists, then attach to this container
    terminalManager.create(sessionId);
    terminalManager.attach(sessionId, container);

    // Get dimensions
    const instance = terminalManager.get(sessionId);
    const cols = instance?.terminal.cols ?? DEFAULT_COLS;
    const rows = instance?.terminal.rows ?? DEFAULT_ROWS;

    // Register binary handler for terminal output
    const unsubBinary = appWs.onTerminal(sessionId, (data: ArrayBuffer) => {
      const view = new Uint8Array(data);
      if (view.length === 0) return;

      const msgType = view[0];

      if (msgType === ServerMessageType.OUTPUT) {
        const payload = data.slice(1);
        terminalManager.write(sessionId, new Uint8Array(payload));
      } else if (msgType === ServerMessageType.ATTACHED) {
        setConnectionStatus(sessionId, 'connected');
      } else if (msgType === ServerMessageType.EXIT) {
        setConnectionStatus(sessionId, 'disconnected');
      } else if (msgType === ServerMessageType.ERROR) {
        setConnectionStatus(sessionId, 'disconnected');
      }
    });

    // Intercept wheel events for tmux scroll
    if (instance) {
      let scrollAccumulator = 0;
      const SCROLL_THRESHOLD = 20;

      instance.terminal.attachCustomWheelEventHandler((e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();

        scrollAccumulator += e.deltaY;

        if (Math.abs(scrollAccumulator) >= SCROLL_THRESHOLD) {
          const button = scrollAccumulator < 0 ? 64 : 65;
          const seq = `\x1b[<${button};1;1M`;
          appWs.sendInput(sessionId, seq);
          scrollAccumulator = 0;
        }

        return true;
      });
    }

    // Pipe terminal input to WebSocket
    const onDataDisposable = instance?.terminal.onData((data: string) => {
      appWs.sendInput(sessionId, data);
    });

    // Handle open — send ATTACH (re-attach on reconnect too)
    const sendAttach = () => {
      setConnectionStatus(sessionId, 'connecting');
      const inst = terminalManager.get(sessionId);
      if (inst) {
        appWs.sendAttach(sessionId, inst.terminal.cols, inst.terminal.rows);
      }
    };

    const unsubOpen = appWs.onOpen(sendAttach);

    const unsubClose = appWs.onClose(() => {
      setConnectionStatus(sessionId, 'disconnected');
    });

    // If already connected, send attach immediately
    if (appWs.connected) {
      sendAttach();
    }
    setConnectionStatus(sessionId, 'connecting');

    // Resize with debounce using ResizeObserver
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(handleResize, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      unsubBinary();
      unsubOpen();
      unsubClose();
      onDataDisposable?.dispose();
      appWs.sendDetach(sessionId); // detach but don't disconnect — shared connection
      terminalManager.detach(sessionId);
    };
  }, [sessionId, containerRef, handleResize, setConnectionStatus]);
}
