import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { OFFICE } from './officeTheme';

interface OfficeTooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  delay?: number;
}

export function OfficeTooltip({ content, children, delay = 300 }: OfficeTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mouseRef = useRef({ x: 0, y: 0 });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    mouseRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      setPosition({ x: mouseRef.current.x, y: mouseRef.current.y + 16 });
      setVisible(true);
    }, delay);
  }, [delay]);

  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  return (
    <>
      <div
        onMouseEnter={show}
        onMouseLeave={hide}
        onMouseMove={handleMouseMove}
        style={{ display: 'contents' }}
      >
        {children}
      </div>
      {visible && createPortal(
        <div
          style={{
            position: 'fixed',
            left: position.x,
            top: position.y,
            transform: 'translateX(-50%)',
            zIndex: 100,
            pointerEvents: 'none',
            maxWidth: 400,
          }}
        >
          <div
            style={{
              background: OFFICE.panelBg,
              border: `1px solid ${OFFICE.panelBorder}`,
              borderRadius: 6,
              padding: '6px 10px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              fontSize: 11,
              color: OFFICE.textPrimary,
              lineHeight: 1.4,
              wordBreak: 'break-all',
            }}
          >
            {content}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
