import { bindingStage } from './analysis';
import { expand } from './expand';
import { batchCycles, clampRho, kingmanWq, unionLength, waitMultiplier } from './math';
import { occupancyResource, resourceById } from './validate';
import type {
  OpenCapacity,
  ProcessDefinition,
  ProcessNode,
  Solver,
  SolverContext,
  StageImpact,
  WorkItem,
} from './types';

const ACTIVE: WorkItem['status'][] = ['committed', 'in_flight'];

export const SEEDED_ACCURACY = {
  windowSize: 20,
  medianAbsPctError: 0.18,
  p80CoverageRate: 0.75,
  lastRefitAt: '2026-08-01',
};

let forecastSeq = 1;

export function bookedOutput(items: WorkItem[]): number {
  return items.filter((item) => ACTIVE.includes(item.status)).reduce((sum, item) => sum + item.variantCount, 0);
}

function blockingExposed(def: ProcessDefinition, node: ProcessNode): boolean {
  return def.edges.some((e) => e.to === node.id && e.transfer?.holdsSourceUntilArrival);
}

function effortUnionDays(node: ProcessNode): number {
  return unionLength(
    node.claims.filter((c) => c.role === 'effort').map((c) => ({ start: c.acquireAtOffset, end: c.releaseAtOffset })),
  );
}

function occupancyUnionDays(node: ProcessNode): number {
  const occ = node.claims.filter((c) => c.role === 'occupancy');
  if (!occ.length) return node.claims[0] ? node.claims[0].releaseAtOffset - node.claims[0].acquireAtOffset : 0;
  return unionLength(occ.map((c) => ({ start: c.acquireAtOffset, end: c.releaseAtOffset })));
}

export interface StageLoad {
  stages: StageImpact[];
  totalQueueDaysBefore: number;
  totalQueueDaysAfter: number;
  designedConstructs: number;
  yieldAmplification: number;
}

export function computeStageLoads(
  def: ProcessDefinition,
  baseline: WorkItem[],
  candidate: WorkItem,
  openCapacity: OpenCapacity,
): StageLoad {
  const booked = Math.max(bookedOutput(baseline), 1);
  const before = expand(def, booked, 'aggregate');
  const after = expand(def, booked + Math.max(0, candidate.variantCount), 'aggregate');
  const source = def.nodes.find((n) => def.edges.every((e) => e.to !== n.id || e.kind === 'iterate')) ?? def.nodes[0];
  const designed = expand(def, candidate.variantCount, 'aggregate').flowByNode.get(source.id) ?? candidate.variantCount;
  const sink = def.nodes.find((n) => def.edges.every((e) => e.from !== n.id || e.kind === 'iterate')) ?? def.nodes[def.nodes.length - 1];
  const sinkFlow = expand(def, candidate.variantCount, 'aggregate').flowByNode.get(sink.id) ?? candidate.variantCount;
  const yieldAmp = sinkFlow <= 0 ? 1 : designed / Math.max(candidate.variantCount, 1);

  const stages: StageImpact[] = [];
  let ca2 = def.ca2Seed;

  for (const node of def.nodes) {
    const resourceId = occupancyResource(node);
    const resource = resourceId ? resourceById(def, resourceId) : undefined;
    if (!resource) continue;
    const unitsBefore = before.demandByNode.get(node.id) ?? 0;
    const unitsAfter = after.demandByNode.get(node.id) ?? 0;
    const open = candidate.consolidate ? (openCapacity[node.id] ?? 0) : 0;
    const cycBefore = batchCycles(unitsBefore, node.batch.quantum, 0, node.batch.closePolicy);
    const increment = Math.max(0, unitsAfter - unitsBefore);
    const added = batchCycles(increment, node.batch.quantum, open, node.batch.closePolicy);
    const cyclesAfter = cycBefore.newCycles + added.newCycles;
    const cycleRatio =
      cycBefore.newCycles <= 0 ? (added.newCycles > 0 ? 1 + added.newCycles : 1) : cyclesAfter / cycBefore.newCycles;

    const effortDays = effortUnionDays(node);
    const occDays = occupancyUnionDays(node);
    const chargeDays = effortDays > 0 && effortDays + 1e-9 < occDays ? effortDays : occDays;
    const rhoScale = occDays > 0 ? chargeDays / occDays : 1;

    const rhoBefore = resource.seedRho * rhoScale;
    const rhoRaw = rhoBefore * cycleRatio;
    const infeasible = rhoRaw >= 1;
    const rhoAfter = infeasible ? 1 : clampRho(rhoRaw);
    const te = resource.teDays;
    const gated = !!node.campaignGated;
    const waitBefore = gated ? 0 : kingmanWq(rhoBefore, te, ca2, resource.cs2);
    const waitAfter = gated ? 0 : infeasible ? Number.POSITIVE_INFINITY : kingmanWq(rhoAfter, te, ca2, resource.cs2);
    const windowFillBefore = gated ? rhoBefore : undefined;
    const windowFillAfter = gated ? rhoAfter : undefined;
    stages.push({
      nodeId: node.id,
      label: node.label,
      resourceId: resource.id,
      role: 'occupancy',
      rhoBefore,
      rhoAfter: infeasible ? 1 : rhoAfter,
      ceiling: resource.targetUtilizationCeiling,
      breachesCeiling: !infeasible && !gated && rhoAfter > resource.targetUtilizationCeiling + 1e-9,
      waitMultiplierBefore: gated ? 0 : waitMultiplier(rhoBefore),
      waitMultiplierAfter: gated ? 0 : infeasible ? Number.POSITIVE_INFINITY : waitMultiplier(rhoAfter),
      waitDaysBefore: waitBefore,
      waitDaysAfter: waitAfter,
      deltaDays: gated ? 0 : infeasible ? Number.POSITIVE_INFINITY : waitAfter - waitBefore,
      shareOfTotalDelta: 0,
      openBatchCapacity: open,
      infeasible: gated ? false : infeasible,
      teDays: te,
      ca2,
      cs2: resource.cs2,
      newCycles: added.newCycles,
      absorbedUnits: added.absorbedUnits,
      campaignGated: gated,
      windowFillBefore,
      windowFillAfter,
      blockingExposed: blockingExposed(def, node),
      sampled: false,
    });
    if (!infeasible && !gated) {
      ca2 = (1 - rhoAfter * rhoAfter) * ca2 + rhoAfter * rhoAfter * resource.cs2;
    }
  }

  const finite = stages.filter((s) => Number.isFinite(s.deltaDays) && s.deltaDays > 0);
  const totalDelta = finite.reduce((sum, s) => sum + s.deltaDays, 0);
  for (const stage of stages) {
    stage.shareOfTotalDelta = totalDelta <= 0 || !Number.isFinite(stage.deltaDays) ? 0 : stage.deltaDays / totalDelta;
  }

  const totalQueueDaysBefore = stages.reduce((sum, s) => sum + (Number.isFinite(s.waitDaysBefore) ? s.waitDaysBefore : 0), 0);
  const totalQueueDaysAfter = stages.some((s) => s.infeasible)
    ? Number.POSITIVE_INFINITY
    : stages.reduce((sum, s) => sum + s.waitDaysAfter, 0);

  return {
    stages,
    totalQueueDaysBefore,
    totalQueueDaysAfter,
    designedConstructs: designed,
    yieldAmplification: yieldAmp <= 0 ? 1 : yieldAmp,
  };
}

export function uniformDemandShock(def: ProcessDefinition, factor: number): StageImpact[] {
  return def.nodes.map((node) => {
    const resource = resourceById(def, occupancyResource(node) ?? '')!;
    const rhoBefore = resource.seedRho;
    const rhoRaw = rhoBefore * factor;
    const infeasible = rhoRaw >= 1;
    const rhoAfter = infeasible ? 1 : rhoRaw;
    const te = resource.teDays;
    const waitBefore = kingmanWq(rhoBefore, te, 1, 1);
    const waitAfter = infeasible ? Number.POSITIVE_INFINITY : kingmanWq(rhoAfter, te, 1, 1);
    return {
      nodeId: node.id,
      label: node.label,
      resourceId: resource.id,
      role: 'occupancy' as const,
      rhoBefore,
      rhoAfter,
      ceiling: resource.targetUtilizationCeiling,
      breachesCeiling: !infeasible && rhoAfter > resource.targetUtilizationCeiling,
      waitMultiplierBefore: waitMultiplier(rhoBefore),
      waitMultiplierAfter: infeasible ? Number.POSITIVE_INFINITY : waitMultiplier(rhoAfter),
      waitDaysBefore: waitBefore,
      waitDaysAfter: waitAfter,
      deltaDays: infeasible ? Number.POSITIVE_INFINITY : waitAfter - waitBefore,
      shareOfTotalDelta: 0,
      openBatchCapacity: 0,
      infeasible,
      teDays: te,
      ca2: 1,
      cs2: 1,
      newCycles: 0,
      absorbedUnits: 0,
      campaignGated: false,
      blockingExposed: false,
      sampled: false,
    };
  });
}

function cycleTime(stages: StageImpact[]): number {
  if (stages.some((s) => s.infeasible)) return Number.POSITIVE_INFINITY;
  return stages.reduce((sum, s) => sum + s.waitDaysAfter + s.teDays, 0);
}

export const analyticalSolver: Solver = {
  id: 'analytical',
  requiredMode: 'aggregate',
  run(ctx: SolverContext) {
    if (ctx.expansion.mode !== 'aggregate') {
      throw new Error('analytical solver must receive mode === aggregate');
    }
    const load = computeStageLoads(ctx.definition, ctx.baseline, ctx.candidate, ctx.openCapacity);
    const infeasible = load.stages.some((s) => s.infeasible);
    const breaches = load.stages.some((s) => s.breachesCeiling);
    const binding = bindingStage(load.stages);
    const p50 = cycleTime(load.stages);
    const sampled = !!ctx.expansion.sampled;
    for (const stage of load.stages) stage.sampled = sampled;
    return {
      forecastId: `fc-${forecastSeq++}`,
      solverId: 'analytical',
      candidate: ctx.candidate,
      verdict: infeasible ? 'infeasible' : breaches ? 'breaches_ceiling' : 'fits_within_slack',
      stages: load.stages,
      bindingNodeId: binding?.nodeId ?? load.stages[0]?.nodeId ?? '',
      scheduleImpacts: [],
      candidateCycleTime: {
        p50,
        p80: Number.isFinite(p50) ? p50 * 1.12 : p50,
        p95: Number.isFinite(p50) ? p50 * 1.28 : p50,
      },
      totalQueueDaysBefore: load.totalQueueDaysBefore,
      totalQueueDaysAfter: load.totalQueueDaysAfter,
      modelAccuracy: SEEDED_ACCURACY,
      computedAt: new Date().toISOString(),
      designedConstructs: load.designedConstructs,
      yieldAmplification: load.yieldAmplification,
      blockingExposed: load.stages.some((s) => s.blockingExposed),
    };
  },
};

export const desStub: Solver = {
  id: 'des',
  requiredMode: 'enumerated',
  run(ctx) {
    if (ctx.expansion.mode !== 'enumerated') {
      throw new Error('des solver must receive mode === enumerated');
    }
    const inner: SolverContext = { ...ctx, expansion: { ...ctx.expansion, mode: 'aggregate' } };
    const result = analyticalSolver.run(inner);
    return { ...result, solverId: 'des', forecastId: `des-${result.forecastId}` };
  },
};

export function effortBusyDays(def: ProcessDefinition, outputCount: number, role: 'effort' | 'occupancy' = 'effort'): number {
  const expansion = expand(def, outputCount, 'aggregate');
  let total = 0;
  for (const node of def.nodes) {
    const demand = expansion.demandByNode.get(node.id) ?? 0;
    const days =
      role === 'effort'
        ? effortUnionDays(node)
        : occupancyUnionDays(node);
    total += demand * days;
  }
  return total;
}
