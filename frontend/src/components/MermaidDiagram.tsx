'use client';

import { useEffect, useRef, useState } from 'react';

export function MermaidDiagram({ chart, className = '' }: { chart: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: 'dark',
          themeVariables: {
            primaryColor: '#2A5ADA',
            primaryTextColor: '#fff',
            primaryBorderColor: '#60A5FA',
            lineColor: '#60A5FA',
            secondaryColor: '#1a3a8f',
            tertiaryColor: '#0D1117',
          },
        });
        const { svg: rendered } = await mermaid.render(idRef.current, chart);
        if (!cancelled) setSvg(rendered);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    run();
    return () => { cancelled = true; };
  }, [chart]);

  if (error) return <div className="text-red-400 text-sm p-4 rounded-lg bg-red-950/30 border border-red-900/50"><strong>Diagram failed to render:</strong><pre className="mt-2 text-xs overflow-auto">{error}</pre></div>;
  if (!svg) return <div className="animate-pulse h-64 rounded-lg bg-white/5" />;

  return (
    <div
      ref={containerRef}
      className={`mermaid-diagram ${className}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
