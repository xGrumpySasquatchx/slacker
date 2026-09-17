import type { ProcessDefinition } from '../engine/types';

function claim(resourceId: string, days: number, order: number, role: 'occupancy' | 'effort' = 'occupancy') {
  return {
    resourceId,
    role,
    acquireAtOffset: 0,
    releaseAtOffset: days,
    quantity: 1,
    exclusive: role === 'occupancy',
    acquireOrder: order,
  };
}

function res(
  id: string,
  name: string,
  actorClass: ProcessDefinition['resources'][number]['actorClass'],
  te: number,
  quantum: number,
  seedRho: number,
  ceiling: number,
  workcellId: string,
): ProcessDefinition['resources'][number] {
  return {
    id,
    name,
    actorClass,
    workcellId,
    cyclesPerPeriod: 1,
    periodDays: 7,
    availability: 1,
    batchQuantum: quantum,
    setupDays: te * 0.3,
    unitDays: quantum === 1 ? 0 : (te * 0.7) / quantum,
    teDays: te,
    targetUtilizationCeiling: ceiling,
    cs2: 1,
    calendarId: 'lab-default',
    seedRho,
  };
}

/** Strain engineering: library design fans out, then a bounded growth cycle. */
export function strainDefinition(): ProcessDefinition {
  const resources = [
    res('res-lib', 'Library design · scientist', 'human', 2, 1, 0.55, 0.8, 'wc-strain'),
    res('res-xform', 'Transformation · robot', 'robot', 1, 96, 0.7, 0.85, 'wc-strain'),
    res('res-grow', 'Growth · incubator', 'instrument', 1.5, 24, 0.82, 0.85, 'wc-strain'),
    res('res-screen', 'Screen · reader', 'instrument', 0.6, 96, 0.6, 0.85, 'wc-strain'),
    res('res-pick', 'Hit pick · robot', 'robot', 0.8, 96, 0.5, 0.9, 'wc-strain'),
  ];
  return {
    id: 'strain-engineering',
    label: 'Strain engineering · library + growth cycle',
    topologyProfile: 'mixed',
    deadlockPolicy: 'ordered',
    workcells: [{ id: 'wc-strain', label: 'Strain lab', resourceIds: resources.map((r) => r.id), calendarId: 'lab-default' }],
    resources,
    nodes: [
      { id: 'lib', label: 'Library design', unitLoad: 1, yieldRate: 0.98, reworkProbability: 0, reworkTargetNodeId: null, maxReworkPasses: 3, batch: { quantum: 1, closePolicy: { kind: 'immediate' } }, claims: [claim('res-lib', 2, 1), claim('res-lib', 2, 2, 'effort')] },
      { id: 'xform', label: 'Transformation', unitLoad: 1, yieldRate: 0.9, reworkProbability: 0, reworkTargetNodeId: null, maxReworkPasses: 3, batch: { quantum: 96, closePolicy: { kind: 'immediate' } }, claims: [claim('res-xform', 1, 1), claim('res-xform', 1, 2, 'effort')] },
      { id: 'grow', label: 'Outgrowth', unitLoad: 1, yieldRate: 0.92, reworkProbability: 0, reworkTargetNodeId: null, maxReworkPasses: 3, batch: { quantum: 24, closePolicy: { kind: 'hybrid', fillFraction: 0.8, maxHoldDays: 3 } }, claims: [claim('res-grow', 1.5, 1), claim('res-grow', 0.4, 2, 'effort')] },
      { id: 'screen', label: 'Phenotypic screen', unitLoad: 1, yieldRate: 0.7, reworkProbability: 0, reworkTargetNodeId: null, maxReworkPasses: 3, batch: { quantum: 96, closePolicy: { kind: 'immediate' } }, claims: [claim('res-screen', 0.6, 1), claim('res-screen', 0.6, 2, 'effort')] },
      { id: 'pick', label: 'Hit pick', unitLoad: 1, yieldRate: 0.95, reworkProbability: 0, reworkTargetNodeId: null, maxReworkPasses: 3, batch: { quantum: 96, closePolicy: { kind: 'immediate' } }, claims: [claim('res-pick', 0.8, 1), claim('res-pick', 0.8, 2, 'effort')] },
    ],
    edges: [
      { id: 'e1', from: 'lib', to: 'xform', kind: 'sequence' },
      { id: 'e2', from: 'xform', to: 'grow', kind: 'fanout', multiplicity: 8 },
      { id: 'e3', from: 'grow', to: 'grow', kind: 'iterate', expectedIterations: 3 },
      { id: 'e4', from: 'grow', to: 'screen', kind: 'sequence' },
      { id: 'e5', from: 'screen', to: 'pick', kind: 'sequence' },
    ],
    ca2Seed: 1,
    horizonDays: 30,
  };
}

/** Analytical panel: one sample fans out to orthogonal assays. */
export function fanoutDefinition(): ProcessDefinition {
  const resources = [
    res('res-prep', 'Sample prep · robot', 'robot', 0.4, 96, 0.64, 0.9, 'wc-an'),
    res('res-ms', 'LC-MS', 'instrument', 1.2, 48, 0.78, 0.85, 'wc-an'),
    res('res-spr', 'SPR', 'instrument', 0.9, 16, 0.71, 0.85, 'wc-an'),
    res('res-elisa', 'ELISA', 'robot', 0.5, 96, 0.58, 0.9, 'wc-an'),
  ];
  return {
    id: 'assay-fanout',
    label: 'Analytics · orthogonal assay fan-out',
    topologyProfile: 'fanout',
    deadlockPolicy: 'ordered',
    workcells: [{ id: 'wc-an', label: 'Analytics', resourceIds: resources.map((r) => r.id), calendarId: 'lab-default' }],
    resources,
    nodes: [
      { id: 'prep', label: 'Sample prep', unitLoad: 1, yieldRate: 0.99, reworkProbability: 0, reworkTargetNodeId: null, maxReworkPasses: 1, batch: { quantum: 96, closePolicy: { kind: 'immediate' } }, claims: [claim('res-prep', 0.4, 1)] },
      { id: 'ms', label: 'LC-MS', unitLoad: 1, yieldRate: 0.97, reworkProbability: 0, reworkTargetNodeId: null, maxReworkPasses: 1, batch: { quantum: 48, closePolicy: { kind: 'immediate' } }, claims: [claim('res-ms', 1.2, 1)] },
      { id: 'spr', label: 'SPR', unitLoad: 1, yieldRate: 0.95, reworkProbability: 0, reworkTargetNodeId: null, maxReworkPasses: 1, batch: { quantum: 16, closePolicy: { kind: 'immediate' } }, claims: [claim('res-spr', 0.9, 1)] },
      { id: 'elisa', label: 'ELISA', unitLoad: 1, yieldRate: 0.98, reworkProbability: 0, reworkTargetNodeId: null, maxReworkPasses: 1, batch: { quantum: 96, closePolicy: { kind: 'immediate' } }, claims: [claim('res-elisa', 0.5, 1)] },
    ],
    edges: [
      { id: 'e-ms', from: 'prep', to: 'ms', kind: 'fanout', multiplicity: 1 },
      { id: 'e-spr', from: 'prep', to: 'spr', kind: 'fanout', multiplicity: 1 },
      { id: 'e-elisa', from: 'prep', to: 'elisa', kind: 'fanout', multiplicity: 1 },
    ],
    ca2Seed: 1,
    horizonDays: 30,
  };
}

/** Two arms (VH / VL) converge onto a single assembly node. */
export function convergentDefinition(): ProcessDefinition {
  const resources = [
    res('res-vh', 'VH cloning · robot', 'robot', 1, 96, 0.68, 0.85, 'wc-asm'),
    res('res-vl', 'VL cloning · robot', 'robot', 1, 96, 0.61, 0.85, 'wc-asm'),
    res('res-asm', 'Pair assembly · robot', 'robot', 1.2, 96, 0.74, 0.85, 'wc-asm'),
    res('res-qc', 'Pair QC · instrument', 'instrument', 1, 48, 0.66, 0.85, 'wc-asm'),
  ];
  return {
    id: 'convergent-pairing',
    label: 'Pairing · VH and VL converge',
    topologyProfile: 'convergent',
    deadlockPolicy: 'ordered',
    workcells: [{ id: 'wc-asm', label: 'Assembly', resourceIds: resources.map((r) => r.id), calendarId: 'lab-default' }],
    resources,
    nodes: [
      { id: 'vh', label: 'VH cloning', unitLoad: 1, yieldRate: 0.9, reworkProbability: 0, reworkTargetNodeId: null, maxReworkPasses: 2, batch: { quantum: 96, closePolicy: { kind: 'immediate' } }, claims: [claim('res-vh', 1, 1)] },
      { id: 'vl', label: 'VL cloning', unitLoad: 1, yieldRate: 0.92, reworkProbability: 0, reworkTargetNodeId: null, maxReworkPasses: 2, batch: { quantum: 96, closePolicy: { kind: 'immediate' } }, claims: [claim('res-vl', 1, 1)] },
      { id: 'asm', label: 'Pair assembly', unitLoad: 1, yieldRate: 0.88, reworkProbability: 0, reworkTargetNodeId: null, maxReworkPasses: 2, batch: { quantum: 96, closePolicy: { kind: 'hybrid', fillFraction: 0.8, maxHoldDays: 2 } }, claims: [claim('res-asm', 1.2, 1)] },
      { id: 'qc', label: 'Pair QC', unitLoad: 1, yieldRate: 0.96, reworkProbability: 0, reworkTargetNodeId: null, maxReworkPasses: 1, batch: { quantum: 48, closePolicy: { kind: 'immediate' } }, claims: [claim('res-qc', 1, 1)] },
    ],
    edges: [
      { id: 'j-vh', from: 'vh', to: 'asm', kind: 'join' },
      { id: 'j-vl', from: 'vl', to: 'asm', kind: 'join' },
      { id: 'e-qc', from: 'asm', to: 'qc', kind: 'sequence' },
    ],
    ca2Seed: 1,
    horizonDays: 30,
  };
}

/** Per-unit: every node is quantum 1. Campaign-gated vendor synthesis sits in its own workcell. */
export function perUnitDefinition(): ProcessDefinition {
  const resources = [
    res('res-design', 'Guide design · in silico', 'in_silico', 0.3, 1, 0.4, 0.9, 'wc-crispr'),
    res('res-syn', 'Oligo synthesis · vendor', 'vendor', 7, 1, 0.5, 0.85, 'wc-vendor'),
    res('res-tx', 'Transfection · operator', 'human', 0.6, 1, 0.62, 0.8, 'wc-crispr'),
    res('res-edit', 'Edit QC · instrument', 'instrument', 1.4, 1, 0.7, 0.85, 'wc-crispr'),
  ];
  return {
    id: 'per-unit-edits',
    label: 'CRISPR edits · per-unit, two workcells',
    topologyProfile: 'per_unit',
    deadlockPolicy: 'ordered',
    workcells: [
      { id: 'wc-crispr', label: 'CRISPR suite', resourceIds: ['res-design', 'res-tx', 'res-edit'], calendarId: 'lab-default' },
      { id: 'wc-vendor', label: 'Vendor synthesis', resourceIds: ['res-syn'], calendarId: 'lab-default', location: 'CRO' },
    ],
    resources,
    nodes: [
      { id: 'design', label: 'Guide design', unitLoad: 1, yieldRate: 1, reworkProbability: 0, reworkTargetNodeId: null, maxReworkPasses: 1, batch: { quantum: 1, closePolicy: { kind: 'immediate' } }, claims: [claim('res-design', 0.3, 1)] },
      { id: 'syn', label: 'Oligo synthesis', unitLoad: 1, yieldRate: 0.95, reworkProbability: 0, reworkTargetNodeId: null, maxReworkPasses: 1, batch: { quantum: 1, closePolicy: { kind: 'immediate' } }, claims: [claim('res-syn', 7, 1)], campaignGated: true },
      { id: 'tx', label: 'Transfection', unitLoad: 1, yieldRate: 0.85, reworkProbability: 0, reworkTargetNodeId: null, maxReworkPasses: 1, batch: { quantum: 1, closePolicy: { kind: 'immediate' } }, claims: [claim('res-tx', 0.6, 1)] },
      { id: 'edit', label: 'Edit QC', unitLoad: 1, yieldRate: 0.9, reworkProbability: 0, reworkTargetNodeId: null, maxReworkPasses: 1, batch: { quantum: 1, closePolicy: { kind: 'immediate' } }, claims: [claim('res-edit', 1.4, 1)] },
    ],
    edges: [
      {
        id: 'e1',
        from: 'design',
        to: 'syn',
        kind: 'sequence',
        transfer: {
          fromWorkcellId: 'wc-crispr',
          toWorkcellId: 'wc-vendor',
          transportResourceId: null,
          durationDays: 0,
          batchQuantum: 1,
          maxQueueDays: null,
          holdsSourceUntilArrival: false,
        },
      },
      {
        id: 'e2',
        from: 'syn',
        to: 'tx',
        kind: 'sequence',
        transfer: {
          fromWorkcellId: 'wc-vendor',
          toWorkcellId: 'wc-crispr',
          transportResourceId: null,
          durationDays: 0,
          batchQuantum: 1,
          maxQueueDays: 5,
          holdsSourceUntilArrival: true,
        },
      },
      { id: 'e3', from: 'tx', to: 'edit', kind: 'sequence' },
    ],
    ca2Seed: 1,
    horizonDays: 30,
  };
}

/** Two effort claims at disjoint offsets — utilization is the union, not the visit length. */
export function unionEffortDefinition(): ProcessDefinition {
  const resources = [res('res-op', 'Operator', 'human', 24, 1, 0.4, 0.8, 'wc-u')];
  return {
    id: 'union-effort',
    label: 'Union effort fixture',
    topologyProfile: 'serial',
    deadlockPolicy: 'ordered',
    workcells: [{ id: 'wc-u', label: 'Fixture', resourceIds: ['res-op'], calendarId: 'lab-default' }],
    resources,
    nodes: [
      {
        id: 'run',
        label: 'Incubation with two pulls',
        unitLoad: 1,
        yieldRate: 1,
        reworkProbability: 0,
        reworkTargetNodeId: null,
        maxReworkPasses: 1,
        batch: { quantum: 1, closePolicy: { kind: 'immediate' } },
        claims: [
          { resourceId: 'res-op', role: 'occupancy', acquireAtOffset: 0, releaseAtOffset: 24, quantity: 1, exclusive: true, acquireOrder: 1 },
          { resourceId: 'res-op', role: 'effort', acquireAtOffset: 0, releaseAtOffset: 2, quantity: 1, exclusive: false, acquireOrder: 2 },
          { resourceId: 'res-op', role: 'effort', acquireAtOffset: 12, releaseAtOffset: 14, quantity: 1, exclusive: false, acquireOrder: 3 },
        ],
      },
    ],
    edges: [],
    ca2Seed: 1,
    horizonDays: 30,
  };
}

/** Opposite acquireOrder on overlapping resources — a potential deadlock at load time. */
export function deadlockFixture(): ProcessDefinition {
  const resources = [
    res('res-a', 'Deck A', 'robot', 4, 1, 0.5, 0.85, 'wc-d'),
    res('res-b', 'Incubator B', 'instrument', 4, 1, 0.5, 0.85, 'wc-d'),
  ];
  return {
    id: 'deadlock-fixture',
    label: 'Deadlock fixture',
    topologyProfile: 'serial',
    deadlockPolicy: 'ordered',
    workcells: [{ id: 'wc-d', label: 'Fixture', resourceIds: ['res-a', 'res-b'], calendarId: 'lab-default' }],
    resources,
    nodes: [
      {
        id: 'left',
        label: 'Hold A, acquire B',
        unitLoad: 1,
        yieldRate: 1,
        reworkProbability: 0,
        reworkTargetNodeId: null,
        maxReworkPasses: 1,
        batch: { quantum: 1, closePolicy: { kind: 'immediate' } },
        claims: [
          { resourceId: 'res-a', role: 'occupancy', acquireAtOffset: 0, releaseAtOffset: 4, quantity: 1, exclusive: true, acquireOrder: 1 },
          { resourceId: 'res-b', role: 'occupancy', acquireAtOffset: 1, releaseAtOffset: 4, quantity: 1, exclusive: true, acquireOrder: 2 },
        ],
      },
      {
        id: 'right',
        label: 'Hold B, acquire A',
        unitLoad: 1,
        yieldRate: 1,
        reworkProbability: 0,
        reworkTargetNodeId: null,
        maxReworkPasses: 1,
        batch: { quantum: 1, closePolicy: { kind: 'immediate' } },
        claims: [
          { resourceId: 'res-b', role: 'occupancy', acquireAtOffset: 0, releaseAtOffset: 4, quantity: 1, exclusive: true, acquireOrder: 1 },
          { resourceId: 'res-a', role: 'occupancy', acquireAtOffset: 1, releaseAtOffset: 4, quantity: 1, exclusive: true, acquireOrder: 2 },
        ],
      },
    ],
    edges: [
      { id: 'e', from: 'left', to: 'right', kind: 'sequence' },
    ],
    ca2Seed: 1,
    horizonDays: 30,
  };
}
