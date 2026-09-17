import { incoming, outgoing } from './validate';
import type { Expansion, ExpansionMode, ProcessDefinition, RoutedUnit, Visit } from './types';

const TOLERANCE = 0.001;
const MAX_ITERS = 20;
const ENUM_CAP = 5000;

function sinks(def: ProcessDefinition): string[] {
  return def.nodes
    .filter((n) => outgoing(def, n.id).every((e) => e.kind === 'iterate'))
    .map((n) => n.id);
}

function multiplicity(kind: string, value: number | undefined): number {
  if (kind === 'fanout') return Math.max(1, value ?? 1);
  return 1;
}

/**
 * One walker, two materializations. Aggregate never enumerates units.
 * Cyclic graphs resolve to a 0.1% fixed point, capped at 20 passes.
 */
export function expand(
  def: ProcessDefinition,
  outputCount: number,
  mode: ExpansionMode,
  cohortId = 'req',
): Expansion {
  const { flowByNode, demandByNode } = expandAggregate(def, outputCount);
  if (mode === 'aggregate') {
    return { mode, demandByNode, flowByNode };
  }
  return enumerate(def, flowByNode, demandByNode, cohortId);
}

export function expandAggregate(
  def: ProcessDefinition,
  outputCount: number,
): { flowByNode: Map<string, number>; demandByNode: Map<string, number> } {
  const neededExits = new Map<string, number>();
  const flowByNode = new Map<string, number>();
  for (const node of def.nodes) {
    neededExits.set(node.id, 0);
    flowByNode.set(node.id, 0);
  }
  const sinkIds = sinks(def);
  const seed = sinkIds.length ? sinkIds : [def.nodes[def.nodes.length - 1].id];
  for (const id of seed) neededExits.set(id, outputCount);

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const prev = new Map(flowByNode);
    for (const node of def.nodes) {
      const y = Math.max(node.yieldRate, 1e-12);
      flowByNode.set(node.id, (neededExits.get(node.id) ?? 0) / y);
    }

    const nextExits = new Map<string, number>();
    for (const node of def.nodes) nextExits.set(node.id, 0);
    for (const id of seed) nextExits.set(id, outputCount);

    const reverse = new Map<string, number[]>();
    const addRev = (id: string, value: number) => {
      const list = reverse.get(id) ?? [];
      list.push(value);
      reverse.set(id, list);
    };

    for (const node of def.nodes) {
      const flow = flowByNode.get(node.id) ?? 0;
      for (const edge of incoming(def, node.id)) {
        if (edge.kind === 'iterate') continue;
        const m = multiplicity(edge.kind, edge.multiplicity);
        addRev(edge.from, flow / m);
      }
      if (node.reworkProbability > 0 && node.reworkTargetNodeId) {
        const failed = flow * (1 - Math.min(node.yieldRate, 1));
        const reworked = failed * node.reworkProbability;
        if (reworked > 0) addRev(node.reworkTargetNodeId, reworked);
      }
    }

    for (const [from, values] of reverse) {
      const outs = outgoing(def, from).filter((e) => e.kind !== 'iterate');
      const split =
        outs.length > 1 && outs.every((e) => (e.multiplicity ?? 1) === 1 && e.kind !== 'join');
      const extra = split ? Math.max(...values) : values.reduce((sum, n) => sum + n, 0);
      nextExits.set(from, (nextExits.get(from) ?? 0) + extra);
    }

    for (const edge of def.edges) {
      if (edge.kind !== 'iterate') continue;
      const k = Math.max(1, edge.expectedIterations ?? 1);
      const extra = (flowByNode.get(edge.from) ?? 0) * (k - 1);
      nextExits.set(edge.to, (nextExits.get(edge.to) ?? 0) + extra);
    }

    neededExits.clear();
    for (const [id, value] of nextExits) neededExits.set(id, value);

    let change = 0;
    for (const node of def.nodes) {
      const a = prev.get(node.id) ?? 0;
      const b = flowByNode.get(node.id) ?? 0;
      change = Math.max(change, a === 0 ? (b > 0 ? 1 : 0) : Math.abs(b - a) / a);
    }
    if (iter > 0 && change < TOLERANCE) break;
  }

  const demandByNode = new Map<string, number>();
  for (const node of def.nodes) {
    const flow = flowByNode.get(node.id) ?? 0;
    demandByNode.set(node.id, flow * Math.max(node.unitLoad, 0));
  }
  return { flowByNode, demandByNode };
}

function enumerate(
  def: ProcessDefinition,
  flowByNode: Map<string, number>,
  _demandByNode: Map<string, number>,
  cohortId: string,
): Expansion {
  const source = def.nodes.find((n) => incoming(def, n.id).every((e) => e.kind === 'iterate')) ?? def.nodes[0];
  const represents = Math.max(flowByNode.get(source.id) ?? 1, 1);
  const enumerated = Math.min(ENUM_CAP, Math.max(1, Math.round(represents)));
  const sampled = represents > ENUM_CAP ? { enumerated, represents } : undefined;
  const scale = represents / enumerated;

  const units: RoutedUnit[] = [];
  let visitSeq = 0;
  for (let i = 0; i < enumerated; i++) {
    const unit: RoutedUnit = { unitId: `${cohortId}.${i}`, cohortId, visits: [] };
    let pred: string[] = [];
    for (const node of def.nodes) {
      const share = (flowByNode.get(node.id) ?? 0) / represents;
      const cap = Math.max(0, Math.round(enumerated * share));
      if (i < cap) {
        const loops = outgoing(def, node.id).find((e) => e.kind === 'iterate');
        const k = Math.max(1, loops?.expectedIterations ?? 1);
        for (let iter = 0; iter < k; iter++) {
          const visitId = `v${visitSeq++}`;
          unit.visits.push({ visitId, nodeId: node.id, iteration: iter, predecessorVisitIds: pred });
          pred = [visitId];
        }
      }
    }
    units.push(unit);
  }

  const enumeratedDemand = new Map<string, number>();
  for (const node of def.nodes) {
    const visits = units.reduce(
      (n, u) => n + u.visits.filter((v) => v.nodeId === node.id && v.iteration === 0).length,
      0,
    );
    enumeratedDemand.set(node.id, visits * scale * Math.max(node.unitLoad, 0));
  }

  return {
    mode: 'enumerated',
    demandByNode: enumeratedDemand,
    flowByNode,
    units,
    sampled,
  };
}

export function visitsFor(units: RoutedUnit[]): Visit[] {
  return units.flatMap((u) => u.visits);
}
