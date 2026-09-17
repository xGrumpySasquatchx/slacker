import { useEffect, useMemo, useState } from 'react';
import { forecastImpact } from './engine/pipeline';
import type {
  DeclinedWorkRecord,
  ImpactForecast,
  Lever,
  ProcessDefinition,
  StageImpact,
  WorkItem,
} from './engine/types';
import { cloneDefinition } from './engine/validate';
import { DefinitionError } from './engine/types';
import { newCandidate, seedOpenCapacity } from './engine/work';
import { observedQueueDays, seedLog, type EventLog } from './engine/events';
import { CATALOG, FORMAT_CODES, FORMAT_LABEL, antibodyDefinition, definitionById, type FormatCode } from './templates';
import {
  addWorkcell,
  assignResource,
  deleteWorkcell,
  instantiateFromTemplate,
  renameProcess,
  updateWorkcell,
} from './engine/workcells';
import { WorkcellEditor } from './Workcells';

function seedProcess(): ProcessDefinition {
  return instantiateFromTemplate(antibodyDefinition('mAb'), 'Antibody cloning');
}

export default function App() {
  const [processes, setProcesses] = useState<ProcessDefinition[]>(() => [seedProcess()]);
  const [activeId, setActiveId] = useState(() => processes[0]?.id ?? '');
  const [creating, setCreating] = useState(false);
  const [newTemplateId, setNewTemplateId] = useState('antibody');
  const [newFormat, setNewFormat] = useState<FormatCode>('mAb');
  const [newName, setNewName] = useState('Antibody cloning');
  const [batchKind, setBatchKind] = useState<'immediate' | 'hybrid'>('immediate');
  const [draft, setDraft] = useState<WorkItem>(() => newCandidate());
  const [debounced, setDebounced] = useState(draft);
  const [accepted, setAccepted] = useState<WorkItem[]>([]);
  const [shadow, setShadow] = useState<DeclinedWorkRecord[]>([]);
  const [applied, setApplied] = useState<Lever['kind'] | null>(null);
  const [log, setLog] = useState<EventLog>(() => seedLog());
  const [leversReady, setLeversReady] = useState(false);

  const stored = processes.find((p) => p.id === activeId) ?? processes[0];
  const definition = useMemo(() => {
    const next = cloneDefinition(stored);
    if (batchKind === 'hybrid') {
      for (const node of next.nodes) {
        if (node.batch.quantum > 1) {
          node.batch.closePolicy = { kind: 'hybrid', fillFraction: 0.8, maxHoldDays: 3 };
        }
      }
    }
    return next;
  }, [stored, batchKind]);

  function patchActive(mutator: (def: ProcessDefinition) => ProcessDefinition) {
    setProcesses((prev) => prev.map((p) => (p.id === stored.id ? mutator(p) : p)));
  }

  function createProcess() {
    const template = newTemplateId === 'antibody' ? antibodyDefinition(newFormat) : definitionById(newTemplateId);
    const process = instantiateFromTemplate(template, newName);
    setProcesses((prev) => [...prev, process]);
    setActiveId(process.id);
    setCreating(false);
    setAccepted([]);
  }

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(draft), 150);
    return () => window.clearTimeout(handle);
  }, [draft]);

  useEffect(() => {
    setLeversReady(false);
    const handle = window.setTimeout(() => setLeversReady(true), 150);
    return () => window.clearTimeout(handle);
  }, [debounced, definition]);

  const booked = useMemo(() => {
    const n = stored.resources.some((r) => r.id === 'res-1') ? 48 : 24;
    return [
      newCandidate({
        id: 'PRJ-2201',
        label: stored.resources.some((r) => r.id === 'res-1') ? 'HER2 panel (booked)' : 'Committed work',
        definitionId: definition.id,
        formatCode: stored.resources.some((r) => r.id === 'res-1') ? 'mAb' : definition.id,
        variantCount: n,
        status: 'committed',
        hardness: 'internal',
      }),
      ...accepted,
    ];
  }, [accepted, stored.id, stored.resources]);
  const open = seedOpenCapacity();
  const rawForecast = useMemo(() => {
    try {
      return forecastImpact(definition, booked, { ...debounced, definitionId: definition.id }, open);
    } catch (err) {
      if (err instanceof DefinitionError) return err;
      throw err;
    }
  }, [definition, booked, debounced]);
  const loadError = rawForecast instanceof DefinitionError ? rawForecast.message : null;
  const result = rawForecast instanceof DefinitionError ? null : rawForecast;
  const levers = !result || !leversReady ? [] : result.levers;

  function patch(partial: Partial<WorkItem>) {
    setApplied(null);
    setDraft((prev) => ({ ...prev, ...partial }));
  }

  function applyLever(lever: Lever) {
    setDraft(lever.apply());
    setApplied(lever.kind);
  }

  function accept() {
    if (!result || result.verdict === 'infeasible') return;
    const item: WorkItem = { ...debounced, status: 'committed', acceptedForecastId: result.forecastId, definitionId: definition.id };
    setAccepted((prev) => [...prev, item]);
    const now = new Date().toISOString();
    setLog((prev) => ({
      visits: [
        {
          workUnitId: item.id,
          cohortId: item.id,
          visitId: `${item.id}:accept`,
          nodeId: result.bindingNodeId,
          iteration: 0,
          workcellId: definition.workcells[0].id,
          batchId: null,
          enqueuedAt: now,
          startedAt: now,
          completedAt: now,
          outcome: 'pass',
        },
        ...prev.visits,
      ],
      claims: [
        {
          visitId: `${item.id}:accept`,
          resourceId: result.stages.find((s) => s.nodeId === result.bindingNodeId)?.resourceId ?? '',
          role: 'occupancy',
          requestedAt: now,
          acquiredAt: now,
          releasedAt: now,
          quantity: item.variantCount,
        },
        ...prev.claims,
      ],
    }));
    setDraft(newCandidate({ id: `PRJ-${String(Date.now()).slice(-4)}` }));
    setApplied(null);
  }

  function decline(reason: DeclinedWorkRecord['reason']) {
    if (!result) return;
    setShadow((prev) => [
      {
        workItem: debounced,
        forecastId: result.forecastId,
        bindingNodeId: result.bindingNodeId,
        reason,
        scopeReductionPct: reason === 'trimmed' && applied === 'trim_scope' ? 100 - (debounced.variantCount / Math.max(draft.variantCount, 1)) * 100 : 0,
        decidedBy: 'C. Olsen',
        decidedAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    setDraft(newCandidate({ id: `PRJ-${String(Date.now()).slice(-4)}` }));
    setApplied(null);
  }

  const forecast = result;
  const binding = forecast?.stages.find((s) => s.nodeId === forecast.bindingNodeId);
  const changed = [...(forecast?.stages ?? [])]
    .filter((s) => s.deltaDays > 0.05 || s.breachesCeiling || s.infeasible)
    .sort((a, b) => b.shareOfTotalDelta - a.shareOfTotalDelta);
  const shown = changed.slice(0, 6);
  const templates = [
    { id: 'antibody', label: 'Antibody cloning (serial)' },
    ...CATALOG.filter((d) => !d.id.startsWith('antibody')).map((d) => ({ id: d.id, label: d.label })),
  ];

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Slacker</h1>
          <p>
            Capacity engine v0.3 — impact preview on resource claims. Slack preservation, not
            throughput. Analytical path only; nothing is scheduled.
          </p>
        </div>
        <span className="version">MVP · analytical</span>
      </header>

      <div className="layout">
        <aside className="col">
          <section className="panel">
            <div className="panel-head">
              <h2>Process</h2>
              <button type="button" className="btn" onClick={() => setCreating((open) => !open)}>
                {creating ? 'Cancel' : 'New process'}
              </button>
            </div>
            {creating && (
              <div className="create-form">
                <label>
                  Template
                  <select
                    className="field"
                    value={newTemplateId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setNewTemplateId(id);
                      setNewName(templates.find((t) => t.id === id)?.label ?? 'New process');
                    }}
                  >
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.label}
                      </option>
                    ))}
                  </select>
                </label>
                {newTemplateId === 'antibody' && (
                  <label>
                    Format
                    <select className="field" value={newFormat} onChange={(e) => setNewFormat(e.target.value as FormatCode)}>
                      {FORMAT_CODES.map((code) => (
                        <option key={code} value={code}>
                          {FORMAT_LABEL[code]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Name
                  <input className="field" value={newName} onChange={(e) => setNewName(e.target.value)} />
                </label>
                <button type="button" className="btn primary" onClick={createProcess}>
                  Create from template
                </button>
              </div>
            )}
            <label>
              Active process
              <select
                className="field"
                value={stored.id}
                onChange={(e) => {
                  setActiveId(e.target.value);
                  setAccepted([]);
                  setApplied(null);
                }}
              >
                {processes.map((process) => (
                  <option key={process.id} value={process.id}>
                    {process.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Process name
              <input
                className="field"
                value={stored.label}
                onChange={(e) => patchActive((def) => renameProcess(def, e.target.value))}
              />
            </label>
            <label>
              Batch close
              <select className="field" value={batchKind} onChange={(e) => setBatchKind(e.target.value as 'immediate' | 'hybrid')}>
                <option value="immediate">Immediate</option>
                <option value="hybrid">Hybrid 80% / 3 d</option>
              </select>
            </label>
            <dl className="meta">
              <div>
                <dt>Topology</dt>
                <dd>{definition.topologyProfile}</dd>
              </div>
              <div>
                <dt>Deadlock policy</dt>
                <dd>{definition.deadlockPolicy}</dd>
              </div>
              <div>
                <dt>Workcells</dt>
                <dd>{definition.workcells.length}</dd>
              </div>
            </dl>
            <ProcessStrip definition={definition} binding={forecast?.bindingNodeId ?? ''} />
          </section>

          <WorkcellEditor
            definition={stored}
            onAdd={() => patchActive((def) => addWorkcell(def))}
            onUpdate={(workcellId, patch) => patchActive((def) => updateWorkcell(def, workcellId, patch))}
            onAssign={(resourceId, workcellId) => patchActive((def) => assignResource(def, resourceId, workcellId))}
            onDelete={(workcellId) => patchActive((def) => deleteWorkcell(def, workcellId))}
          />

          <section className="panel">
            <h2>Static validation</h2>
            {loadError ? (
              <p className="warn">{loadError}</p>
            ) : forecast?.deadlockCycles.length === 0 ? (
              <p className="hint">No potential deadlock. Acquire order is acyclic across claims.</p>
            ) : (
              <p className="warn">
                Potential deadlock: {forecast?.deadlockCycles.map((c) => c.resourceIds.join(' → ')).join(' · ')}
              </p>
            )}
            {forecast?.blockingExposed && (
              <p className="warn">
                Blocking-exposed claims (source held until arrival). Kingman understates wait here —
                confidence band is wide until DES.
              </p>
            )}
            {forecast?.sampled && <p className="hint">Enumerated sample in use. Figures are labelled sampled.</p>}
          </section>
        </aside>

        <main className="col main">
          <p className="prompt">
            Slack is unused capacity that absorbs failed ligations and instrument downtime. Preview
            the consequence, then accept, adjust, or decline — decline is recorded.
          </p>
          {forecast ? (
            <>
          <CapacityRibbon stages={forecast.stages} binding={forecast.bindingNodeId} />
          <div className="propose">
            <label>
              Proposed work
              <input className="field" value={draft.label} onChange={(e) => patch({ label: e.target.value })} />
            </label>
            <label>
              Requested outputs
              <input
                className="field num"
                type="number"
                min={1}
                value={draft.variantCount}
                onChange={(e) => patch({ variantCount: Math.max(1, Number(e.target.value) || 1) })}
              />
            </label>
            <label>
              Hardness
              <select className="field" value={draft.hardness} onChange={(e) => patch({ hardness: e.target.value as WorkItem['hardness'] })}>
                <option value="soft">Soft</option>
                <option value="internal">Internal</option>
                <option value="contractual">Contractual</option>
              </select>
            </label>
            <label>
              Start
              <input className="field" type="date" value={draft.requestedStart} onChange={(e) => patch({ requestedStart: e.target.value })} />
            </label>
          </div>

          <VerdictBanner forecast={forecast} />

          <div className="kpis">
            <Kpi label="Designed / started" value={fmt(forecast.designedConstructs, 0)} />
            <Kpi label="Demand amplification" value={`${fmt(forecast.yieldAmplification, 2)}×`} />
            <Kpi label="Queue before" value={`${fmt(forecast.totalQueueDaysBefore, 1)} d`} />
            <Kpi
              label="Queue after"
              value={Number.isFinite(forecast.totalQueueDaysAfter) ? `${fmt(forecast.totalQueueDaysAfter, 1)} d` : 'infeasible'}
              warn={forecast.verdict === 'infeasible'}
            />
            <Kpi label="P50 cycle time" value={finiteDays(forecast.candidateCycleTime.p50)} />
            <Kpi label="P80 / P95" value={`${finiteDays(forecast.candidateCycleTime.p80)} / ${finiteDays(forecast.candidateCycleTime.p95)}`} />
          </div>

          {binding && (
            <div className="bind">
              <strong>
                Binding constraint · {binding.label}
                {binding.campaignGated ? ' · campaign window (not Kingman)' : ''}
              </strong>
              <span>
                {fmt(binding.shareOfTotalDelta * 100, 0)}% of added delay · wait {fmt(binding.waitDaysBefore, 1)} d →{' '}
                {Number.isFinite(binding.waitDaysAfter) ? `${fmt(binding.waitDaysAfter, 1)} d` : 'infeasible'}
                {binding.blockingExposed ? ' · blocking-exposed' : ''}
                {binding.sampled ? ' · sampled' : ''}
              </span>
            </div>
          )}

          <div className="bars">
            {shown.map((stage) => (
              <StageBar key={stage.nodeId} stage={stage} />
            ))}
            {changed.length > shown.length && (
              <p className="hint">{changed.length - shown.length} quieter stages collapsed — they are not the decision.</p>
            )}
          </div>

          <LeverList levers={levers} applied={applied} onApply={applyLever} verdict={forecast.verdict} ready={leversReady} />

          <div className="actions">
            <button className="btn primary" disabled={forecast.verdict === 'infeasible'} onClick={accept}>
              Accept work
            </button>
            <button className="btn" disabled={!levers[0]} onClick={() => levers[0] && applyLever(levers[0])}>
              Adjust with top lever
            </button>
            <button className="btn" onClick={() => decline('declined')}>
              Decline
            </button>
          </div>
          {accepted.length > 0 && (
            <p className="hint">Accepted this session: {accepted.map((i) => i.label).join(', ')}. Reload clears it.</p>
          )}
            </>
          ) : (
            <p className="warn">{loadError ?? 'Definition failed to load.'}</p>
          )}
        </main>

        <aside className="col">
          <section className="panel">
            <h2>Calibration</h2>
            <p className="hint">
              Last {forecast?.modelAccuracy.windowSize ?? 20} completed items · median |error|{' '}
              {((forecast?.modelAccuracy.medianAbsPctError ?? 0) * 100).toFixed(0)}% · P80 coverage{' '}
              {((forecast?.modelAccuracy.p80CoverageRate ?? 0) * 100).toFixed(0)}% · observed queue wait (acquired −
              requested) {fmt(observedQueueDays(log), 2)} d · {log.visits.length} visit events · {log.claims.length}{' '}
              claim events.
            </p>
          </section>
          <section className="panel">
            <h2>Shadow backlog</h2>
            {shadow.length === 0 ? (
              <p className="hint">Empty. Declined work lands here, aggregated by binding stage.</p>
            ) : (
              shadow.map((row) => (
                <div key={`${row.forecastId}-${row.decidedAt}`} className="slip">
                  <span>
                    {row.workItem.label} · {row.workItem.variantCount} · {row.bindingNodeId}
                  </span>
                  <span>{row.reason}</span>
                </div>
              ))
            )}
          </section>
          <section className="panel">
            <h2>Book</h2>
            {booked.map((item) => (
              <div key={item.id} className="slip">
                <span>
                  {item.label} · {item.variantCount}
                </span>
                <span>{item.status}</span>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}

function ProcessStrip({ definition, binding }: { definition: ProcessDefinition; binding: string }) {
  return (
    <div className="strip">
      {definition.nodes.map((node, i) => (
        <span key={node.id} className={`chip${node.id === binding ? ' bind' : ''}`}>
          {i + 1} {node.label}
        </span>
      ))}
    </div>
  );
}

function CapacityRibbon({ stages, binding }: { stages: StageImpact[]; binding: string }) {
  return (
    <div className="ribbon">
      {stages.map((stage) => (
        <div
          key={stage.nodeId}
          className={`tick${stage.nodeId === binding ? ' bind' : ''}${stage.breachesCeiling || stage.infeasible ? ' hot' : ''}${stage.campaignGated ? ' gated' : ''}`}
          title={`${stage.label}: ${pct(stage.rhoAfter)} after candidate, ceiling ${pct(stage.ceiling)}${stage.campaignGated ? ' (window fill)' : ''}`}
        >
          <span className="tick-bar" style={{ height: `${Math.min(100, stage.rhoAfter * 100)}%` }} />
          <span className="tick-ceil" style={{ bottom: `${stage.ceiling * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

function StageBar({ stage }: { stage: StageImpact }) {
  const before = Math.min(100, stage.rhoBefore * 100);
  const after = Math.min(100, stage.rhoAfter * 100);
  return (
    <div className={`bar${stage.infeasible ? ' infeasible' : stage.breachesCeiling ? ' breach' : ''}`}>
      <span className="bar-name">
        {stage.label}
        {stage.campaignGated ? ' · window' : ''}
      </span>
      <div className="track">
        <span className="fill before" style={{ width: `${before}%` }} />
        <span className="fill delta" style={{ left: `${before}%`, width: `${Math.max(0, after - before)}%` }} />
        <span className="ceil" style={{ left: `${stage.ceiling * 100}%` }} />
      </div>
      <span className="bar-rho">
        {pct(stage.rhoBefore)} → {stage.infeasible ? '≥100%' : pct(stage.rhoAfter)}
      </span>
    </div>
  );
}

function VerdictBanner({ forecast }: { forecast: ImpactForecast }) {
  const copy =
    forecast.verdict === 'fits_within_slack'
      ? 'Fits within slack. Accepting still records claim events for calibration.'
      : forecast.verdict === 'breaches_ceiling'
        ? 'Breaches a slack ceiling. Adjust is the primary action; Accept stays available.'
        : 'Structurally infeasible — at least one stage is at or above 100% utilization. Accept is disabled.';
  return <div className={`banner ${forecast.verdict}`}>{copy}</div>;
}

function LeverList({
  levers,
  applied,
  onApply,
  verdict,
  ready,
}: {
  levers: Lever[];
  applied: Lever['kind'] | null;
  onApply: (lever: Lever) => void;
  verdict: ImpactForecast['verdict'];
  ready: boolean;
}) {
  if (!ready) return <p className="hint">Levers computing…</p>;
  if (!levers.length) {
    return (
      <p className="hint">
        {verdict === 'fits_within_slack'
          ? 'No lever required — the candidate fits the slack policy.'
          : 'No reversible lever recovers slack inside this horizon.'}
      </p>
    );
  }
  return (
    <div className="levers">
      {levers.map((lever) => (
        <button key={lever.kind} type="button" className={`lever${applied === lever.kind ? ' on' : ''}`} onClick={() => onApply(lever)}>
          <strong>{lever.label}</strong>
          <span>{lever.detail}</span>
          <span className="lever-meta">
            {fmt(lever.slackRecoveredPct, 1)} pp slack · {fmt(lever.scopeCostPct, 0)}% scope · {fmt(lever.daysRecovered, 1)} d
          </span>
        </button>
      ))}
    </div>
  );
}

function Kpi({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`kpi${warn ? ' warn' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function fmt(n: number, digits: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function pct(rho: number): string {
  return `${Math.round(rho * 100)}%`;
}

function finiteDays(n: number): string {
  return Number.isFinite(n) ? `${fmt(n, 1)} d` : '—';
}
