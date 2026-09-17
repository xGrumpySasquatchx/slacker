import type { ActorClass, ClaimTemplate, ProcessDefinition, ProcessNode, Resource } from '../engine/types';

interface SpineRow {
  index: number;
  name: string;
  actorClass: ActorClass;
  quantum: number;
  te: number;
  yieldRate: number;
  reworkTarget: number | null;
  seedRho: number;
  ceiling: number;
  resourceName: string;
}

const SPINE: SpineRow[] = [
  { index: 1, name: 'Construct design', actorClass: 'human', quantum: 1, te: 1.5, yieldRate: 0.98, reworkTarget: null, seedRho: 0.72, ceiling: 0.8, resourceName: 'Construct design · scientist + in silico' },
  { index: 2, name: 'Codon optimization, synthesis order', actorClass: 'in_silico', quantum: 1, te: 0.2, yieldRate: 1, reworkTarget: null, seedRho: 0.35, ceiling: 0.9, resourceName: 'Codon optimization' },
  { index: 3, name: 'Gene synthesis', actorClass: 'vendor', quantum: 1, te: 10, yieldRate: 0.94, reworkTarget: 1, seedRho: 0.6, ceiling: 0.85, resourceName: 'Gene synthesis · vendor lead time' },
  { index: 4, name: 'Vector assembly, cloning', actorClass: 'robot', quantum: 96, te: 1, yieldRate: 0.88, reworkTarget: 4, seedRho: 0.78, ceiling: 0.85, resourceName: 'Cloning · 96-well robot' },
  { index: 5, name: 'Transformation, plating', actorClass: 'robot', quantum: 96, te: 0.8, yieldRate: 0.95, reworkTarget: 4, seedRho: 0.66, ceiling: 0.85, resourceName: 'Transformation · 96-well robot' },
  { index: 6, name: 'Colony pick, outgrowth', actorClass: 'robot', quantum: 96, te: 1.5, yieldRate: 0.92, reworkTarget: 5, seedRho: 0.7, ceiling: 0.85, resourceName: 'Colony pick · 96-well robot' },
  { index: 7, name: 'Plasmid prep', actorClass: 'robot', quantum: 96, te: 0.7, yieldRate: 0.97, reworkTarget: 6, seedRho: 0.74, ceiling: 0.9, resourceName: 'Plasmid prep · 96-well robot' },
  { index: 8, name: 'Sequence verification', actorClass: 'instrument', quantum: 96, te: 2, yieldRate: 0.85, reworkTarget: 6, seedRho: 0.69, ceiling: 0.8, resourceName: 'Sanger / NGS verification' },
  { index: 9, name: 'DNA normalization, transfection prep', actorClass: 'robot', quantum: 96, te: 0.5, yieldRate: 0.99, reworkTarget: null, seedRho: 0.63, ceiling: 0.9, resourceName: 'Transfection prep · robot' },
  { index: 10, name: 'Transient expression', actorClass: 'instrument', quantum: 24, te: 6, yieldRate: 0.9, reworkTarget: 9, seedRho: 0.85, ceiling: 0.85, resourceName: 'Expression · shaker slots' },
  { index: 11, name: 'Harvest, clarification', actorClass: 'human', quantum: 1, te: 0.5, yieldRate: 0.99, reworkTarget: null, seedRho: 0.58, ceiling: 0.8, resourceName: 'Harvest · operator run' },
  { index: 12, name: 'Affinity capture', actorClass: 'instrument', quantum: 8, te: 0.8, yieldRate: 0.93, reworkTarget: 10, seedRho: 0.62, ceiling: 0.85, resourceName: 'Affinity capture · AKTA' },
  { index: 13, name: 'Polish, SEC', actorClass: 'instrument', quantum: 8, te: 0.7, yieldRate: 0.91, reworkTarget: 12, seedRho: 0.55, ceiling: 0.85, resourceName: 'Polish / SEC · AKTA' },
  { index: 14, name: 'Buffer exchange, concentration', actorClass: 'robot', quantum: 24, te: 0.5, yieldRate: 0.98, reworkTarget: null, seedRho: 0.52, ceiling: 0.9, resourceName: 'Buffer exchange · robot' },
  { index: 15, name: 'Release QC, registration', actorClass: 'instrument', quantum: 48, te: 1.5, yieldRate: 0.96, reworkTarget: 12, seedRho: 0.71, ceiling: 0.85, resourceName: 'Release QC · LC-MS' },
];

function claimsFor(row: SpineRow): ClaimTemplate[] {
  const resourceId = `res-${row.index}`;
  const effortEnd = row.te;
  return [
    { resourceId, role: 'occupancy', acquireAtOffset: 0, releaseAtOffset: row.te, quantity: 1, exclusive: true, acquireOrder: 1 },
    { resourceId, role: 'effort', acquireAtOffset: 0, releaseAtOffset: effortEnd, quantity: 1, exclusive: false, acquireOrder: 2 },
  ];
}

function resourceFrom(row: SpineRow): Resource {
  const quantum = Math.max(1, row.quantum);
  return {
    id: `res-${row.index}`,
    name: row.resourceName,
    actorClass: row.actorClass,
    workcellId: 'wc-ab',
    cyclesPerPeriod: 1,
    periodDays: 7,
    availability: 1,
    batchQuantum: quantum,
    setupDays: quantum === 1 ? row.te : row.te * 0.3,
    unitDays: quantum === 1 ? 0 : (row.te * 0.7) / quantum,
    teDays: row.te,
    targetUtilizationCeiling: row.ceiling,
    cs2: 1,
    calendarId: 'lab-default',
    seedRho: row.seedRho,
  };
}

function nodeFrom(row: SpineRow, unitLoad: number): ProcessNode {
  return {
    id: `n${row.index}`,
    label: row.name,
    unitLoad,
    yieldRate: row.yieldRate,
    reworkProbability: 0,
    reworkTargetNodeId: row.reworkTarget ? `n${row.reworkTarget}` : null,
    maxReworkPasses: 3,
    batch: { quantum: Math.max(1, row.quantum), closePolicy: { kind: 'immediate' } },
    claims: claimsFor(row),
  };
}

export const FORMAT_CODES = ['mAb', 'bsAb_kih', 'triAb', 'ADC'] as const;
export type FormatCode = (typeof FORMAT_CODES)[number];

export const FORMAT_LABEL: Record<FormatCode, string> = {
  mAb: 'mAb',
  bsAb_kih: 'Bispecific (KiH)',
  triAb: 'Trispecific',
  ADC: 'ADC',
};

function loadFor(format: FormatCode, index: number): number {
  const clone = format === 'triAb' ? 1.6 : format === 'bsAb_kih' ? 1.25 : format === 'ADC' ? 1.35 : 1;
  const expr = format === 'triAb' ? 1.5 : format === 'bsAb_kih' ? 1.2 : 1;
  if (index >= 4 && index <= 8) return clone;
  if (index === 10) return expr;
  return 1;
}

export function antibodyDefinition(format: FormatCode = 'mAb'): ProcessDefinition {
  const resources = SPINE.map(resourceFrom);
  return {
    id: `antibody-${format}`,
    label: `Antibody cloning · ${FORMAT_LABEL[format]}`,
    topologyProfile: 'serial',
    deadlockPolicy: 'ordered',
    workcells: [{ id: 'wc-ab', label: 'Antibody lab', resourceIds: resources.map((r) => r.id), calendarId: 'lab-default' }],
    resources,
    nodes: SPINE.map((row) => nodeFrom(row, loadFor(format, row.index))),
    edges: SPINE.slice(0, -1).map((row) => ({
      id: `e-${row.index}`,
      from: `n${row.index}`,
      to: `n${row.index + 1}`,
      kind: 'sequence' as const,
    })),
    ca2Seed: 1,
    horizonDays: 30,
  };
}

export function yieldOnlyAntibody(): ProcessDefinition {
  const def = antibodyDefinition('mAb');
  return {
    ...def,
    id: 'antibody-yield',
    nodes: def.nodes.map((n) => ({ ...n, unitLoad: 1, reworkProbability: 0, reworkTargetNodeId: null })),
  };
}
