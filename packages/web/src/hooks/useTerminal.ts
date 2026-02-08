import { useEffect, useRef, useCallback } from 'react';
import { DEFAULT_COLS, DEFAULT_ROWS, RESIZE_DEBOUNCE_MS, ServerMessageType, WS_TERMINAL_PATH } from '@asm/shared';
import { terminalManager } from '../services/terminalManager';
import { WebSocketManager } from '../services/websocket';
import { useTerminalStore } from '../stores/terminalStore';
import { WS_BASE_URL } from '../lib/constants';

export function useTerminal(sessionId: string | null, containerRef: React.RefObject<HTMLElement | null>) {
  const setConnectionStatus = useTerminalStore((s) => s.setConnectionStatus);
  const wsRef = useRef<WebSocketManager | null>(null);

  const handleResize = useCallback(() => {
    if (!sessionId) return;
    terminalManager.resize(sessionId);
    const instance = terminalManager.get(sessionId);
    if (instance && wsRef.current) {
      wsRef.current.sendResize(instance.terminal.cols, instance.terminal.rows);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !containerRef.current) return;

    const container = containerRef.current;

    // Create per-instance WebSocket connection
    const ws = new WebSocketManager();
    wsRef.current = ws;

    // Create terminal if not exists, then attach to this container
    terminalManager.create(sessionId);
    terminalManager.attach(sessionId, container);

    // Get dimensions
    const instance = terminalManager.get(sessionId);
    const cols = instance?.terminal.cols ?? DEFAULT_COLS;
    const rows = instance?.terminal.rows ?? DEFAULT_ROWS;

    // Register message handler BEFORE connecting (avoid race condition)
    const unsubMessage = ws.onMessage((data: ArrayBuffer) => {
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
      instance.terminal.attachCustomWheelEventHandler((e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const lines = Math.max(1, Math.round(Math.abs(e.deltaY) / 25));
        const button = e.deltaY < 0 ? 64 : 65;
        const seq = `\x1b[<${button};1;1M`;
        for (let i = 0; i < lines; i++) {
          ws.sendInput(seq);
        }
        return true;
      });
    }

    // Pipe terminal input to this pane's WebSocket
    const onDataDisposable = instance?.terminal.onData((data: string) => {
      ws.sendInput(data);
    });

    // Handle connection status
    const unsubOpen = ws.onOpen(() => {
      setConnectionStatus(sessionId, 'connecting');
      const inst = terminalManager.get(sessionId);
      if (inst) {
        ws.sendAttach(sessionId, inst.terminal.cols, inst.terminal.rows);
      }
    });

    const unsubClose = ws.onClose(() => {
      setConnectionStatus(sessionId, 'disconnected');
    });

    // Connect WebSocket and send attach
    ws.connect(`${WS_BASE_URL}${WS_TERMINAL_PATH}`);
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
      unsubMessage();
      unsubOpen();
      unsubClose();
      onDataDisposable?.dispose();
      ws.sendDetach();
      ws.disconnect();
      wsRef.current = null;
      terminalManager.detach(sessionId);
    };
  }, [sessionId, containerRef, handleResize, setConnectionStatus]);
}
