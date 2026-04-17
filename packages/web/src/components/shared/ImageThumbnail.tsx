import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface ImageThumbnailProps {
  src: string;
  alt?: string;
}

export function ImageThumbnail({ src, alt }: ImageThumbnailProps) {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, close]);

  return (
    <>
      <img
        src={src}
        alt={alt ?? ''}
        className="inline-block w-24 h-24 object-cover rounded-md border border-[var(--theme-border)] cursor-pointer hover:ring-2 hover:ring-[var(--theme-accent)] transition my-1 mr-1"
        loading="lazy"
        onClick={() => setOpen(true)}
      />

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
            onClick={close}
          >
            <div
              className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button
                className="absolute -top-3 -right-3 w-8 h-8 flex items-center justify-center rounded-full bg-black/60 text-white/80 hover:text-white hover:bg-black/80 transition text-lg leading-none z-10"
                onClick={close}
                aria-label="Close"
              >
                &times;
              </button>

              <img
                src={src}
                alt={alt ?? ''}
                className="max-w-full max-h-[85vh] rounded-md object-contain shadow-2xl"
              />

              {alt && (
                <p className="text-xs text-white/70 mt-2 px-4 text-center">{alt}</p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
