'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MermaidDiagram } from './MermaidDiagram';

export function MermaidModal({ chart, title, className = '' }: { chart: string; title?: string; className?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`w-full rounded-xl overflow-hidden p-4 md:p-6 min-h-[200px] flex flex-col items-center justify-center cursor-pointer transition-all hover:opacity-90 hover:border-white/20 group ${className}`}
        style={{ background: 'rgba(13,17,23,0.6)', border: '1px solid rgba(33,41,58,0.6)' }}
      >
        <MermaidDiagram chart={chart} className="w-full [&_svg]:w-full [&_svg]:h-auto pointer-events-none" />
        <span className="text-[10px] mt-2 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: 'var(--text-muted)' }}>Click to enlarge</span>
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] m-0 p-0"
            style={{
              background: 'rgba(0,0,0,0.25)',
              top: 0, left: 0, right: 0, bottom: 0,
              width: '100vw', height: '100vh',
              minWidth: '100%', minHeight: '100%',
            }}
            onClick={() => setOpen(false)}
          >
            <div
              className="absolute top-0 left-0 right-0 bottom-0 w-full h-full overflow-auto p-4 flex flex-col"
              style={{ background: 'rgba(13,17,23,0.55)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full flex items-center justify-center text-white hover:bg-white/10 transition-colors"
                aria-label="Close"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              {title && (
                <h3 className="text-lg font-bold text-white mb-4">{title}</h3>
              )}
              <div className="flex-1 flex items-center justify-center min-h-0 w-full">
                <MermaidDiagram chart={chart} className="w-full min-w-0 [&_svg]:w-full [&_svg]:h-auto [&_svg]:max-w-none" />
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
