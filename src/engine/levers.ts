import { computeStageLoads } from './analytical';
import { cloneWork } from './work';
import type { Lever, OpenCapacity, ProcessDefinition, WorkItem } from './types';

function fits(def: ProcessDefinition, baseline: WorkItem[], candidate: WorkItem, open: OpenCapacity): boolean {
  const load = computeStageLoads(def, baseline, candidate, open);
  return load.stages.every((s) => !s.infeasible && !s.breachesCeiling);
}

function recovered(before: ReturnType<typeof computeStageLoads>, after: ReturnType<typeof computeStageLoads>) {
  const bind = before.stages.reduce((b, s) => (s.shareOfTotalDelta > b.shareOfTotalDelta ? s : b), before.stages[0]);
  const next = after.stages.find((s) => s.nodeId === bind.nodeId) ?? after.stages[0];
  const slack = (bind.rhoAfter - next.rhoAfter) * 100;
  const days =
    Number.isFinite(before.totalQueueDaysAfter) && Number.isFinite(after.totalQueueDaysAfter)
      ? before.totalQueueDaysAfter - after.totalQueueDaysAfter
      : 0;
  return { slack, days };
}

export function solveBatchConsolidate(
  def: ProcessDefinition,
  baseline: WorkItem[],
  candidate: WorkItem,
  openCapacity: OpenCapacity,
): Lever | null {
  if (def.topologyProfile === 'per_unit') return null;
  if (candidate.consolidate) return null;
  const closed = computeStageLoads(def, baseline, { ...candidate, consolidate: false }, openCapacity);
  const open = computeStageLoads(def, baseline, { ...candidate, consolidate: true }, openCapacity);
  const { slack, days } = recovered(closed, open);
  const openWells = Object.values(openCapacity).reduce((sum, n) => sum + n, 0);
  if (openWells <= 0 && slack <= 0.05) return null;
  const next = cloneWork(candidate);
  next.consolidate = true;
  return {
    kind: 'batch_consolidate',
    label: 'Fill open batches first',
    detail: `${openWells} unused well${openWells === 1 ? '' : 's'} already scheduled. Merging into them adds no plate cycle at those stages.`,
    slackRecoveredPct: slack,
    scopeCostPct: 0,
    daysRecovered: days,
    efficiency: slack / 0.01,
    apply: () => cloneWork(next),
  };
}

export function solveTrimScope(
  def: ProcessDefinition,
  baseline: WorkItem[],
  candidate: WorkItem,
  openCapacity: OpenCapacity,
): Lever | null {
  if (candidate.variantCount <= 1) return null;
  if (fits(def, baseline, candidate, openCapacity)) return null;
  let lo = 0;
  let hi = candidate.variantCount;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(def, baseline, { ...candidate, variantCount: mid }, openCapacity)) lo = mid;
    else hi = mid - 1;
  }
  if (lo <= 0 || lo >= candidate.variantCount) return null;
  const trimmed = cloneWork(candidate);
  trimmed.variantCount = lo;
  const before = computeStageLoads(def, baseline, candidate, openCapacity);
  const after = computeStageLoads(def, baseline, trimmed, openCapacity);
  const { slack, days } = recovered(before, after);
  const scopeCost = ((candidate.variantCount - lo) / candidate.variantCount) * 100;
  return {
    kind: 'trim_scope',
    label: `Trim to ${lo} outputs`,
    detail: `Largest request that stays under every stage ceiling. Drops ${candidate.variantCount - lo} of ${candidate.variantCount}.`,
    slackRecoveredPct: slack,
    scopeCostPct: scopeCost,
    daysRecovered: days,
    efficiency: slack / Math.max(scopeCost, 0.01),
    apply: () => cloneWork(trimmed),
  };
}

export function solveReduceFanout(
  def: ProcessDefinition,
  baseline: WorkItem[],
  candidate: WorkItem,
  openCapacity: OpenCapacity,
): Lever | null {
  if (def.topologyProfile !== 'fanout' && def.topologyProfile !== 'mixed') return null;
  const edge = def.edges.find((e) => e.kind === 'fanout' && (e.multiplicity ?? 1) > 1);
  if (!edge) return null;
  const before = computeStageLoads(def, baseline, candidate, openCapacity);
  const halved = Math.max(1, Math.floor((edge.multiplicity ?? 1) / 2));
  if (halved >= (edge.multiplicity ?? 1)) return null;
  const trimmed = cloneWork(candidate);
  trimmed.variantCount = Math.max(1, Math.round(candidate.variantCount * (halved / (edge.multiplicity ?? 1))));
  const after = computeStageLoads(def, baseline, trimmed, openCapacity);
  const { slack, days } = recovered(before, after);
  const scopeCost = ((candidate.variantCount - trimmed.variantCount) / candidate.variantCount) * 100;
  return {
    kind: 'reduce_fanout',
    label: `Cut fan-out ${edge.multiplicity} → ${halved}`,
    detail: 'Fewer copies per parent unit. Scope falls with the multiplicity.',
    slackRecoveredPct: slack,
    scopeCostPct: scopeCost,
    daysRecovered: days,
    efficiency: slack / Math.max(scopeCost, 0.01),
    apply: () => cloneWork(trimmed),
  };
}

export function rankLevers(
  def: ProcessDefinition,
  baseline: WorkItem[],
  candidate: WorkItem,
  openCapacity: OpenCapacity,
): Lever[] {
  return [solveBatchConsolidate(def, baseline, candidate, openCapacity), solveTrimScope(def, baseline, candidate, openCapacity), solveReduceFanout(def, baseline, candidate, openCapacity)]
    .filter((lever): lever is Lever => lever != null)
    .sort((a, b) => b.efficiency - a.efficiency);
}
