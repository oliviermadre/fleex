import { useEffect, useRef, useCallback } from 'react';
import { DEFAULT_COLS, DEFAULT_ROWS, RESIZE_DEBOUNCE_MS, ServerMessageType } from '@asm/shared';
import { terminalManager } from '../services/terminalManager';
import { terminalWs } from '../services/websocket';
import { useTerminalStore } from '../stores/terminalStore';

export function useTerminal(sessionId: string | null, containerRef: React.RefObject<HTMLElement | null>) {
  const prevSessionRef = useRef<string | null>(null);
  const setConnectionStatus = useTerminalStore((s) => s.setConnectionStatus);

  const handleResize = useCallback(() => {
    if (!sessionId) return;
    terminalManager.resize(sessionId);
    const instance = terminalManager.get(sessionId);
    if (instance) {
      terminalWs.sendResize(instance.terminal.cols, instance.terminal.rows);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !containerRef.current) return;

    const container = containerRef.current;

    // Set container on terminal manager
    terminalManager.setContainer(container);

    // Detach previous session if different
    if (prevSessionRef.current && prevSessionRef.current !== sessionId) {
      terminalWs.sendDetach();
      terminalManager.detach(prevSessionRef.current);
    }
    prevSessionRef.current = sessionId;

    // Create terminal if not exists, then attach
    terminalManager.create(sessionId);
    terminalManager.attach(sessionId);

    // Get dimensions
    const instance = terminalManager.get(sessionId);
    const cols = instance?.terminal.cols ?? DEFAULT_COLS;
    const rows = instance?.terminal.rows ?? DEFAULT_ROWS;

    // Register message handler BEFORE sending attach (avoid race condition)
    const unsubMessage = terminalWs.onMessage((data: ArrayBuffer) => {
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

    // Intercept wheel events and send SGR mouse wheel sequences directly to tmux.
    // tmux uses alternate screen so xterm.js has no scrollback to scroll through;
    // this sends wheel events that tmux (with mouse on) interprets as copy-mode scroll.
    if (instance) {
      instance.terminal.attachCustomWheelEventHandler((e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const lines = Math.max(1, Math.round(Math.abs(e.deltaY) / 25));
        // SGR extended mouse: button 64 = wheel up, 65 = wheel down
        const button = e.deltaY < 0 ? 64 : 65;
        const seq = `\x1b[<${button};1;1M`;
        for (let i = 0; i < lines; i++) {
          terminalWs.sendInput(seq);
        }
        return true;
      });
    }

    // Pipe terminal input to WebSocket
    const onDataDisposable = instance?.terminal.onData((data: string) => {
      terminalWs.sendInput(data);
    });

    // Handle connection status
    const unsubOpen = terminalWs.onOpen(() => {
      setConnectionStatus(sessionId, 'connecting');
      const inst = terminalManager.get(sessionId);
      if (inst) {
        terminalWs.sendAttach(sessionId, inst.terminal.cols, inst.terminal.rows);
      }
    });

    const unsubClose = terminalWs.onClose(() => {
      setConnectionStatus(sessionId, 'disconnected');
    });

    // Now send attach (handlers already registered)
    setConnectionStatus(sessionId, 'connecting');
    terminalWs.sendAttach(sessionId, cols, rows);

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
      unsubMessage();
      unsubOpen();
      unsubClose();
      onDataDisposable?.dispose();
    };
  }, [sessionId, containerRef, handleResize, setConnectionStatus]);

  // Cleanup on full unmount
  useEffect(() => {
    return () => {
      if (prevSessionRef.current) {
        terminalWs.sendDetach();
      }
    };
  }, []);
}
