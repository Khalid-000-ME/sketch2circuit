'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Capture from '@/components/Capture';
import Findings from '@/components/Findings';
import Inspector from '@/components/Inspector';
import SourceImage from '@/components/SourceImage';
import StageStatus from '@/components/StageStatus';
import Schematic from '@/components/Schematic';
import Viewer from '@/components/Viewer';
import {
  analyze, ApiError, fetchStatus, prepareImage, simulate, toSpiceNetlist, type SampleInfo,
} from '@/lib/client/api';
import type { AnalyzeResponse, CircuitComponent, Net } from '@/lib/types';

type Phase = 'capture' | 'analysing' | 'result';
/**
 * Schematic by default: it is the representation a beginner will meet everywhere
 * else, and at these scales a true-to-life 3D board makes a 9V block dwarf a 5mm
 * LED, which is accurate and unhelpful. The 3D board stays one click away.
 */
type ViewMode = 'schematic' | 'board';

/** Honest stage labels, shown in the order the pipeline actually runs them. */
const STAGE_LABELS = [
  'Reading the page with Muse Spark…',
  'Segmenting symbols and wires with SAM 3.1…',
  'Walking the wire mask for connectivity…',
  'Reading handwritten values from each crop…',
  'Solving the operating point and running the checks…',
];

export default function Page() {
  const [phase, setPhase] = useState<Phase>('capture');
  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [components, setComponents] = useState<CircuitComponent[]>([]);
  const [nets, setNets] = useState<Net[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [stage, setStage] = useState(0);
  const [resimulating, setResimulating] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('schematic');

  const abortRef = useRef<AbortController | null>(null);
  const editSeq = useRef(0);

  useEffect(() => {
    fetchStatus()
      .then((s) => { setSamples(s.samples); setLive(s.live); })
      .catch(() => setLive(false));
  }, []);

  // The stage ticker reflects the order the server works in, not a measured
  // position, so it never claims a stage is finished.
  useEffect(() => {
    if (phase !== 'analysing') return;
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, STAGE_LABELS.length - 1)), 2600);
    return () => clearInterval(timer);
  }, [phase]);

  const runAnalysis = useCallback(async (blob: Blob, preview: string, sampleId?: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setPreviewUrl(preview);
    setStage(0);
    setPhase('analysing');
    try {
      const response = await analyze(blob, sampleId, controller.signal);
      setResult(response);
      setComponents(response.components);
      setNets(response.nets);
      setSelectedId(null);
      setPhase('result');
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof ApiError ? err.message : 'Something went wrong analysing that. Try again.');
      setPhase('capture');
    }
  }, []);

  const handleFile = useCallback(async (file: File) => {
    try {
      const { blob, previewUrl: url } = await prepareImage(file);
      await runAnalysis(blob, url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That image could not be read. Try a JPEG or PNG.');
    }
  }, [runAnalysis]);

  /** A photo sent from a paired phone goes through exactly the path an upload does. */
  const handlePhoneImage = useCallback(async (blob: Blob) => {
    await runAnalysis(blob, URL.createObjectURL(blob));
  }, [runAnalysis]);

  const handleSample = useCallback(async (sample: SampleInfo) => {
    try {
      const res = await fetch(sample.image);
      const blob = await res.blob();
      await runAnalysis(blob, sample.image, sample.id);
    } catch {
      setError('That sample could not be loaded. Try again.');
    }
  }, [runAnalysis]);

  /** Re-solves after an edit. US-05 asks for under two seconds; this is local work. */
  const resimulate = useCallback(async (nextComponents: CircuitComponent[], nextNets: Net[]) => {
    const seq = ++editSeq.current;
    setResimulating(true);
    try {
      const res = await simulate({ components: nextComponents, nets: nextNets });
      if (seq !== editSeq.current) return; // A newer edit already landed.
      setComponents(res.components);
      setNets(res.nets);
      setResult((prev) => (prev ? {
        ...prev,
        components: res.components,
        nets: res.nets,
        simulation: res.simulation,
        findings: res.findings,
      } : prev));
    } catch {
      setError('That edit could not be simulated. The previous result is still shown.');
    } finally {
      if (seq === editSeq.current) setResimulating(false);
    }
  }, []);

  const handleChange = useCallback((id: string, patch: Partial<CircuitComponent>) => {
    setComponents((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, ...patch } : c));
      void resimulate(next, nets);
      return next;
    });
  }, [nets, resimulate]);

  const handleDelete = useCallback((id: string) => {
    setComponents((prev) => {
      const next = prev.filter((c) => c.id !== id);
      const prunedNets = nets
        .map((n) => ({ ...n, pins: n.pins.filter((p) => p.split('.')[0] !== id) }))
        .filter((n) => n.pins.length > 0);
      setNets(prunedNets);
      void resimulate(next, prunedNets);
      return next;
    });
    setSelectedId(null);
  }, [nets, resimulate]);

  const selectAndFocus = useCallback((id: string) => {
    setSelectedId(id);
    setFocusToken((t) => t + 1);
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setPhase('capture');
    setResult(null);
    setComponents([]);
    setNets([]);
    setSelectedId(null);
    setError(null);
  }, []);

  const exportNetlist = useCallback(() => {
    const text = toSpiceNetlist({ components, nets });
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result?.circuit_id ?? 'circuit'}.cir`;
    a.click();
    URL.revokeObjectURL(url);
  }, [components, nets, result]);

  const selected = useMemo(
    () => components.find((c) => c.id === selectedId) ?? null,
    [components, selectedId],
  );

  if (phase === 'capture' || phase === 'analysing') {
    return (
      <main className="workspace-grid flex min-h-full flex-1 flex-col">
        {phase === 'analysing' ? (
          <div className="flex flex-1 items-center justify-center px-5">
            <div className="w-full max-w-md text-center">
              {previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="The sketch being analysed"
                  className="mx-auto mb-7 max-h-56 rounded-lg border border-edge object-contain"
                />
              )}
              <div className="relative h-0.5 overflow-hidden rounded-full bg-edge sweep" />
              <p className="mt-5 text-[14px] text-ink" aria-live="polite">{STAGE_LABELS[stage]}</p>
              <p className="mt-2 text-[12px] text-faint">
                A first analysis takes up to fifteen seconds. Edits after that are instant.
              </p>
              <button
                type="button"
                onClick={reset}
                className="mt-6 text-[12px] text-faint underline underline-offset-4 transition hover:text-dim"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <Capture
            samples={samples}
            live={live}
            busy={false}
            error={error}
            onFile={handleFile}
            onSample={handleSample}
            onPhoneImage={handlePhoneImage}
          />
        )}
      </main>
    );
  }

  const simulation = result?.simulation ?? null;
  const findings = result?.findings ?? [];
  const errorCount = findings.filter((f) => f.severity === 'error').length;

  return (
    <main className="flex min-h-full flex-1 flex-col lg:h-screen lg:overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b border-edge px-4 py-2.5">
        <button
          type="button"
          onClick={reset}
          className="flex h-9 items-center gap-2 rounded-md border border-edge px-3 text-[13px] text-dim transition hover:border-accent/50 hover:text-ink"
        >
          ← New sketch
        </button>

        <div className="ml-1 flex items-center gap-2 text-[13px]">
          {errorCount > 0 ? (
            <>
              <span className="h-2 w-2 rounded-full bg-error" aria-hidden />
              <span className="text-error">
                {errorCount} problem{errorCount > 1 ? 's' : ''} found
              </span>
            </>
          ) : (
            <>
              <span className="h-2 w-2 rounded-full bg-ok" aria-hidden />
              <span className="text-ok">No errors found</span>
            </>
          )}
          {resimulating && <span className="ml-1 text-[12px] text-faint">re-solving…</span>}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-md border border-edge p-0.5" role="group" aria-label="View">
            {([['schematic', 'Schematic'], ['board', '3D board']] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                aria-pressed={viewMode === mode}
                className={`h-8 rounded px-2.5 text-[12px] transition ${
                  viewMode === mode ? 'bg-accent/15 text-accent' : 'text-faint hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {result?.cached ? (
            <span
              className="rounded border border-warn/40 bg-warn/10 px-2 py-1 text-[11px] text-warn"
              title="Live analysis did not finish, so an earlier run of this sample is shown."
            >
              Cached result
            </span>
          ) : (
            result?.timings?.total_ms != null && (
              <span className="hidden text-[11px] text-faint sm:inline">
                analysed in {(Number(result.timings.total_ms) / 1000).toFixed(1)}s
              </span>
            )
          )}
          <button
            type="button"
            onClick={exportNetlist}
            className="h-9 rounded-md border border-edge px-3 text-[13px] text-dim transition hover:border-accent/50 hover:text-ink"
          >
            Export netlist
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="workspace-grid relative h-[46vh] min-h-[320px] shrink-0 bg-bg lg:h-auto lg:min-h-0 lg:flex-1">
          {viewMode === 'schematic' ? (
            <Schematic
              circuitId={result?.circuit_id ?? 'none'}
              components={components}
              nets={nets}
              simulation={simulation}
              findings={findings}
              selectedId={selectedId}
              focusToken={focusToken}
              onSelect={setSelectedId}
              onHover={() => {}}
            />
          ) : (
            <>
              <Viewer
                circuitId={result?.circuit_id ?? 'none'}
                components={components}
                nets={nets}
                simulation={simulation}
                findings={findings}
                selectedId={selectedId}
                focusToken={focusToken}
                onSelect={setSelectedId}
                onHover={() => {}}
              />
              <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-faint">
                Drag to orbit · pinch or scroll to zoom · tap a component
              </p>
            </>
          )}
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-t border-edge p-4 lg:w-[400px] lg:border-l lg:border-t-0 xl:w-[440px]">
          <Findings findings={findings} selectedId={selectedId} onSelect={selectAndFocus} />

          <Inspector
            component={selected}
            nets={nets}
            simulation={simulation}
            onChange={handleChange}
            onDelete={handleDelete}
            onClose={() => setSelectedId(null)}
          />

          {components.length > 0 && (
            <div className="rounded-lg border border-edge bg-raised p-3.5">
              <h3 className="text-[11px] uppercase tracking-wider text-faint">
                Components ({components.length})
              </h3>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {components.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => selectAndFocus(c.id)}
                      className={`h-9 rounded-md border px-2.5 font-mono text-[12px] transition ${
                        c.id === selectedId
                          ? 'border-accent/60 bg-accent/10 text-accent'
                          : 'border-edge bg-panel text-dim hover:border-edge-strong hover:text-ink'
                      }`}
                    >
                      {c.id}
                      <span className="ml-1.5 font-sans text-faint">{c.value ?? '—'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result && <StageStatus confidence={result.confidence} traced={result.segmentation?.wire_trace_used} />}

          {result && result.warnings.length > 0 && (
            <div className="rounded-lg border border-edge bg-raised p-3.5">
              <h3 className="text-[11px] uppercase tracking-wider text-faint">Worth checking</h3>
              <ul className="mt-2 space-y-1.5">
                {result.warnings.map((w, i) => (
                  <li key={i} className="text-[12px] leading-relaxed text-dim">— {w}</li>
                ))}
              </ul>
            </div>
          )}

          {previewUrl && <SourceImage src={previewUrl} segmentation={result?.segmentation} />}
        </aside>
      </div>
    </main>
  );
}
