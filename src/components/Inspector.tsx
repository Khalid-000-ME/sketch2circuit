'use client';

import { useState } from 'react';
import type { CircuitComponent, ComponentType, Net, PinState, Simulation } from '@/lib/types';
import { PINS } from '@/lib/types';
import { BOARDS, isBoardType, isGpio } from '@/lib/circuit/boards';
import { defaultPinState } from '@/lib/circuit/solve';
import { fmtA, fmtV, fmtW, formatValue, parseValue } from '@/lib/circuit/units';

/**
 * The inspector: what the system believes about one component, and the controls
 * to correct it.
 *
 * Every field here is editable because every field is a vision output that can be
 * wrong, and one wrong reading should not invalidate the whole analysis (US-07).
 * Edits re-run the analysis immediately — no save button, no confirmation.
 */

const TYPE_OPTIONS: Array<{ value: ComponentType; label: string }> = [
  { value: 'resistor', label: 'Resistor' },
  { value: 'led', label: 'LED' },
  { value: 'battery', label: 'Battery / supply' },
  { value: 'ground', label: 'Ground' },
  { value: 'capacitor', label: 'Capacitor (ceramic)' },
  { value: 'capacitor_electrolytic', label: 'Capacitor (electrolytic)' },
  { value: 'diode', label: 'Diode' },
  { value: 'switch', label: 'Switch' },
  { value: 'potentiometer', label: 'Potentiometer' },
  { value: 'transistor', label: 'Transistor' },
  { value: 'ic', label: 'IC (DIP)' },
  { value: 'inductor', label: 'Inductor' },
  { value: 'crystal', label: 'Crystal' },
  { value: 'buzzer', label: 'Buzzer' },
  { value: 'motor', label: 'Motor' },
  { value: 'header', label: 'Header pins' },
  { value: 'arduino_uno', label: 'Arduino Uno' },
  { value: 'raspberry_pi', label: 'Raspberry Pi' },
  { value: 'junction', label: 'Junction' },
  { value: 'unknown', label: 'Unknown' },
];

const VALUE_HINT: Partial<Record<ComponentType, { label: string; placeholder: string; unit: string }>> = {
  resistor: { label: 'Resistance', placeholder: '220, 4k7, 10k', unit: 'Ω' },
  potentiometer: { label: 'Track resistance', placeholder: '10k', unit: 'Ω' },
  battery: { label: 'Voltage', placeholder: '9', unit: 'V' },
  capacitor: { label: 'Capacitance', placeholder: '100n', unit: 'F' },
  capacitor_electrolytic: { label: 'Capacitance', placeholder: '10u', unit: 'F' },
  inductor: { label: 'Inductance', placeholder: '1m', unit: 'H' },
  led: { label: 'Colour', placeholder: 'red, green, blue', unit: '' },
  buzzer: { label: 'Resistance', placeholder: '100', unit: 'Ω' },
  motor: { label: 'Winding resistance', placeholder: '10', unit: 'Ω' },
};

interface Props {
  component: CircuitComponent | null;
  /** Every part, because what a pin defaults to depends on the other boards. */
  components: CircuitComponent[];
  nets: Net[];
  simulation: Simulation | null;
  onChange: (id: string, patch: Partial<CircuitComponent>) => void;
  onPinState: (id: string, pin: string, state: PinState) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export default function Inspector({ component, components, nets, simulation, onChange, onPinState, onDelete, onClose }: Props) {
  const [draft, setDraft] = useState(component?.value ?? '');
  // React's documented way to reset state when a prop changes: compare against
  // what we last rendered and adjust during render, rather than in an effect
  // that would paint one frame with the previous component's value still in the
  // field.
  const identity = `${component?.id ?? ''}:${component?.value ?? ''}`;
  const [lastIdentity, setLastIdentity] = useState(identity);
  if (identity !== lastIdentity) {
    setLastIdentity(identity);
    setDraft(component?.value ?? '');
  }

  if (!component) {
    return (
      <div className="rounded-lg border border-edge bg-raised p-4">
        <p className="text-[13px] leading-relaxed text-faint">
          Click any component on the board to inspect it — its type, its value, what it connects to,
          and the current, voltage and power through it.
        </p>
      </div>
    );
  }

  const result = simulation?.component_results[component.id];
  const hint = VALUE_HINT[component.type];
  const board = isBoardType(component.type) ? BOARDS[component.type] : null;
  const connections = PINS[component.type]
    .map((pin) => {
      const ref = `${component.id}.${pin}`;
      const net = nets.find((n) => n.pins.includes(ref));
      const others = net?.pins.filter((p) => p !== ref) ?? [];
      return { pin, net, others };
    })
    // A board has dozens of pins and most are meant to be unused, so only the ones
    // in use are listed; the rest would be a wall of "not connected".
    .filter((row) => !board || (row.net && row.others.length > 0));

  const commit = () => {
    const next = draft.trim();
    if (next === (component.value ?? '')) return;
    onChange(component.id, { value: next === '' ? null : next, user_edited: true });
  };

  const parsed = parseValue(draft);

  return (
    <div className="rounded-lg border border-accent/30 bg-raised">
      <header className="flex items-center gap-2 border-b border-edge px-4 py-3">
        <span className="rounded bg-accent/15 px-2 py-0.5 font-mono text-[13px] font-semibold text-accent">
          {component.id}
        </span>
        <span className="text-[13px] text-dim">
          {TYPE_OPTIONS.find((t) => t.value === component.type)?.label ?? component.type}
        </span>
        <span className="ml-auto text-[11px] text-faint" title="How sure the vision stage was about this component">
          {Math.round(component.confidence * 100)}% sure
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="-mr-1 flex h-7 w-7 items-center justify-center rounded text-faint transition hover:bg-white/5 hover:text-ink"
        >
          ✕
        </button>
      </header>

      <div className="space-y-4 p-4">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider text-faint">Component type</span>
          <select
            value={component.type}
            onChange={(e) => onChange(component.id, { type: e.target.value as ComponentType, user_edited: true })}
            className="mt-1.5 h-11 w-full rounded-md border border-edge bg-panel px-3 text-[13px] text-ink transition hover:border-edge-strong focus:border-accent focus:outline-none"
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-faint">
            Read it wrong? Change it here and the analysis re-runs.
          </span>
        </label>

        {hint && (
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-faint">{hint.label}</span>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                placeholder={hint.placeholder}
                inputMode={component.type === 'led' ? 'text' : 'decimal'}
                className="h-11 min-w-0 flex-1 rounded-md border border-edge bg-panel px-3 font-mono text-[13px] text-ink transition hover:border-edge-strong focus:border-accent focus:outline-none"
              />
              {hint.unit && <span className="shrink-0 font-mono text-[13px] text-dim">{hint.unit}</span>}
            </div>
            {parsed != null && hint.unit && (
              <span className="mt-1 block font-mono text-[11px] text-faint">
                = {formatValue(parsed, hint.unit)}
              </span>
            )}
          </label>
        )}

        {component.type === 'switch' && (
          <div>
            <span className="text-[11px] uppercase tracking-wider text-faint">State</span>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(['closed', 'open'] as const).map((state) => (
                <button
                  key={state}
                  type="button"
                  onClick={() => onChange(component.id, { value: state, user_edited: true })}
                  className={`h-11 rounded-md border text-[13px] capitalize transition ${
                    (component.value ?? 'closed') === state
                      ? 'border-accent/60 bg-accent/10 text-accent'
                      : 'border-edge bg-panel text-dim hover:border-edge-strong'
                  }`}
                >
                  {state}
                </button>
              ))}
            </div>
          </div>
        )}

        {board && simulation?.status === 'ok' && (
          <BoardPins
            component={component}
            components={components}
            nets={nets}
            simulation={simulation}
            onPinState={onPinState}
          />
        )}

        {!board && result && simulation?.status === 'ok' && (
          <div>
            <span className="text-[11px] uppercase tracking-wider text-faint">Operating point</span>
            <dl className="mt-1.5 grid grid-cols-3 gap-2">
              {[
                { label: 'Current', value: fmtA(Math.abs(result.current_a)) },
                { label: 'Voltage', value: fmtV(result.voltage_v) },
                { label: 'Power', value: fmtW(result.power_w) },
              ].map((cell) => (
                <div key={cell.label} className="rounded-md border border-edge bg-panel px-2.5 py-2">
                  <dt className="text-[10px] uppercase tracking-wider text-faint">{cell.label}</dt>
                  <dd className="mt-0.5 font-mono text-[13px] text-ink">{cell.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <div>
          <span className="text-[11px] uppercase tracking-wider text-faint">Connections</span>
          <ul className="mt-1.5 space-y-1.5">
            {connections.map(({ pin, net, others }) => (
              <li key={pin} className="flex items-start gap-2 text-[12px]">
                <span className="mt-px w-[68px] shrink-0 font-mono text-dim">{pin}</span>
                {net ? (
                  <span className="text-ink">
                    <span className="font-mono text-accent/80">{net.id}</span>
                    {others.length > 0 && (
                      <span className="text-dim"> → {others.join(', ')}</span>
                    )}
                    {net.is_ground && <span className="ml-1.5 text-faint">(ground)</span>}
                  </span>
                ) : (
                  <span className="text-warn">not connected</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        {component.orientation && (
          <p className="text-[12px] text-faint">
            Orientation read from the sketch: <span className="font-mono text-dim">{component.orientation.replace(/_/g, ' ')}</span>
          </p>
        )}

        <button
          type="button"
          onClick={() => onDelete(component.id)}
          className="h-10 w-full rounded-md border border-edge text-[13px] text-dim transition hover:border-error/50 hover:bg-error/10 hover:text-error"
        >
          Remove {component.id} from the circuit
        </button>
      </div>
    </div>
  );
}

const STATES: Array<[PinState, string]> = [['high', 'High'], ['low', 'Low'], ['input', 'Input']];

/**
 * What each wired pin of a board is doing.
 *
 * What a pin is doing is set by firmware, which a sketch cannot show, so it is
 * assumed and the assumption is editable here. Each pin shows the current it is
 * delivering, because "will this damage the pin" is the question being asked.
 */
function BoardPins({
  component, components, nets, simulation, onPinState,
}: {
  component: CircuitComponent;
  components: CircuitComponent[];
  nets: Net[];
  simulation: Simulation;
  onPinState: (id: string, pin: string, state: PinState) => void;
}) {
  if (!isBoardType(component.type)) return null;
  const spec = BOARDS[component.type];
  const wired = component.pins.filter((pin) => {
    const net = nets.find((n) => n.pins.includes(`${component.id}.${pin}`));
    return net && net.pins.length > 1;
  });
  const gpio = wired.filter((pin) => isGpio(component.type as 'arduino_uno', pin));
  const power = wired.filter((pin) => pin in spec.power);

  if (gpio.length === 0 && power.length === 0) return null;
  const amps = (pin: string) => Math.abs(simulation.pin_currents?.[`${component.id}.${pin}`] ?? 0);

  return (
    <div>
      <span className="text-[11px] uppercase tracking-wider text-faint">Pins in use</span>
      <ul className="mt-1.5 space-y-2">
        {power.map((pin) => (
          <li key={pin} className="flex items-center gap-2 text-[12px]">
            <span className="w-14 shrink-0 font-mono text-dim">{pin}</span>
            <span className="text-faint">supply</span>
            <span className="ml-auto font-mono text-ink">{fmtA(amps(pin))}</span>
          </li>
        ))}
        {gpio.map((pin) => {
          const explicit = component.pin_states?.[pin];
          const state = explicit ?? defaultPinState({ components, nets }, component.id, pin);
          const driven = state !== 'input';
          return (
            <li key={pin} className="text-[12px]">
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 font-mono text-dim">{pin}</span>
                <div className="flex rounded-md border border-edge p-0.5" role="group" aria-label={`${pin} state`}>
                  {STATES.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => onPinState(component.id, pin, value)}
                      aria-pressed={state === value}
                      className={`h-8 min-w-12 rounded px-2 transition ${
                        state === value ? 'bg-accent/15 text-accent' : 'text-faint hover:text-ink'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="ml-auto font-mono text-ink">{driven ? fmtA(amps(pin)) : '—'}</span>
              </div>
              {!explicit && <p className="ml-16 mt-0.5 text-[11px] text-faint">assumed</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
