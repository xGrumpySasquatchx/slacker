import { expand } from '../src/engine/expand';
import { materializeClaims } from '../src/engine/claims';
import { detectPotentialDeadlock } from '../src/engine/deadlock';
import { batchCycles, unionLength } from '../src/engine/math';
import { analyticalSolver, desStub, effortBusyDays, uniformDemandShock } from '../src/engine/analytical';
import { forecastImpact } from '../src/engine/pipeline';
import { validateDefinition, cloneDefinition } from '../src/engine/validate';
import { DefinitionError } from '../src/engine/types';
import { rankLevers } from '../src/engine/levers';
import { newCandidate, seedBook } from '../src/engine/work';
import { seedLog } from '../src/engine/events';
import {
  antibodyDefinition,
  deadlockFixture,
  perUnitDefinition,
  strainDefinition,
  unionEffortDefinition,
  yieldOnlyAntibody,
} from '../src/templates';
import {
  addWorkcell,
  assignResource,
  deleteWorkcell,
  instantiateFromTemplate,
  updateWorkcell,
} from '../src/engine/workcells';

let failures = 0;

function check(label: string, condition: boolean, detail = '') {
  if (!condition) failures++;
  console.log(`${condition ? 'pass' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

function endToEndYield(def: ReturnType<typeof yieldOnlyAntibody>): number {
  return def.nodes.reduce((p, n) => p * n.yieldRate, 1);
}

console.log('— capacity engine v0.3 —');

const antibody = yieldOnlyAntibody();
validateDefinition(antibody);
const claimsOnly = materializeClaims(antibody, expand(antibody, 48, 'aggregate'));
check('AC1 definition loads, expands, and produces claims with no solver', claimsOnly.length > 0);

const agg = expand(antibody, 48, 'aggregate');
const enu = expand(antibody, 48, 'enumerated');
const demandClose = antibody.nodes.every((n) => {
  const a = agg.demandByNode.get(n.id) ?? 0;
  const b = enu.demandByNode.get(n.id) ?? 0;
  if (a === 0 && b === 0) return true;
  return Math.abs(a - b) / Math.max(a, b) <= 0.01;
});
check('AC2 aggregate and enumerated demandByNode agree within 1%', demandClose);
check('analytical path is aggregate', agg.mode === 'aggregate' && !agg.units);
check('enumerated path materializes units', (enu.units?.length ?? 0) > 0);

const huge = expand(antibody, 8000, 'enumerated');
check('AC3 enumeration above 5,000 units sets sampled', !!huge.sampled && huge.sampled.enumerated === 5000, JSON.stringify(huge.sampled));

try {
  const bad = cloneDefinition(perUnitDefinition());
  bad.nodes[0].batch.quantum = 96;
  validateDefinition(bad);
  check('AC4 per_unit rejects quantum !== 1', false);
} catch (err) {
  check('AC4 per_unit rejects quantum !== 1', err instanceof DefinitionError);
}

try {
  const bad = cloneDefinition(strainDefinition());
  for (const edge of bad.edges) if (edge.kind === 'iterate') delete edge.expectedIterations;
  validateDefinition(bad);
  check('AC5 cyclic iterate requires expectedIterations', false);
} catch (err) {
  check('AC5 cyclic iterate requires expectedIterations', err instanceof DefinitionError);
}

try {
  const bad = cloneDefinition(strainDefinition());
  bad.edges = bad.edges.filter((e) => e.kind !== 'iterate');
  bad.edges.push({ id: 'loop', from: 'grow', to: 'xform', kind: 'sequence' });
  bad.topologyProfile = 'serial';
  validateDefinition(bad);
  check('AC6 unbounded cycle rejected at load', false);
} catch (err) {
  check('AC6 unbounded cycle rejected at load', err instanceof DefinitionError);
}

const dead = deadlockFixture();
validateDefinition(dead);
const deadClaims = materializeClaims(dead, expand(dead, 1, 'aggregate'));
const cycles = detectPotentialDeadlock(deadClaims);
check('AC7 opposite acquireOrder reports a deadlock cycle', cycles.some((c) => c.resourceIds.includes('res-a') && c.resourceIds.includes('res-b')), cycles.map((c) => c.resourceIds.join('>')).join(','));

try {
  const bad = cloneDefinition(perUnitDefinition());
  const edge = bad.edges.find((e) => e.id === 'e2')!;
  delete edge.transfer;
  validateDefinition(bad);
  check('AC8 cross-workcell sequence requires TransferSpec', false);
} catch (err) {
  check('AC8 cross-workcell sequence requires TransferSpec', err instanceof DefinitionError);
}

const unionDef = unionEffortDefinition();
const effort = effortBusyDays(unionDef, 1, 'effort');
const occ = effortBusyDays(unionDef, 1, 'occupancy');
check('AC9 two disjoint effort claims charge the union (4d) not the visit (24d)', Math.abs(effort - 4) < 1e-6 && Math.abs(occ - 24) < 1e-6, `effort=${effort} occ=${occ}`);
check('unionLength overlaps once', unionLength([{ start: 0, end: 10 }, { start: 6, end: 12 }]) === 12);

const y = endToEndYield(antibody);
const designed48 = agg.flowByNode.get('n1') ?? 0;
check('end-to-end yield on the antibody spine is 41%', Math.abs(y - 0.41) < 0.01, y.toFixed(3));
check('a request for 48 outputs expands to 117 ± 2 designed constructs', Math.abs(designed48 - 117) <= 2, designed48.toFixed(1));

const SHOCK = [
  ['n1', 3.86, 5.03],
  ['n2', 0.11, 0.12],
  ['n3', 15.0, 17.93],
  ['n4', 3.55, 5.05],
  ['n5', 1.55, 1.92],
  ['n6', 3.5, 4.48],
  ['n7', 1.99, 2.67],
  ['n8', 4.45, 5.63],
  ['n9', 0.85, 1.03],
  ['n10', 34.0, 60.3],
  ['n11', 0.69, 0.82],
  ['n12', 1.31, 1.57],
  ['n13', 0.86, 1.0],
  ['n14', 0.54, 0.63],
  ['n15', 3.67, 4.74],
] as const;
const shocked = uniformDemandShock(antibodyDefinition('mAb'), 1.07);
const within2 = SHOCK.every(([id, before, after]) => {
  const row = shocked.find((s) => s.nodeId === id);
  if (!row) return false;
  const ok = (got: number, exp: number) => Math.abs(got - exp) <= Math.max(exp * 0.02, 0.03);
  return ok(row.waitDaysBefore, before) && ok(row.waitDaysAfter, after);
});
check('AC10 uniform +7% demand reproduces the v0.2 wait table within 2%', within2);

const expr = shocked.find((s) => s.nodeId === 'n10')!;
const shockDelta = shocked.reduce((sum, s) => sum + s.deltaDays, 0);
check('expression is 71% of the added delay', Math.abs(expr.deltaDays / shockDelta - 0.71) < 0.03, `${((expr.deltaDays / shockDelta) * 100).toFixed(1)}%`);

const live = antibodyDefinition('mAb');
validateDefinition(live);
const t0 = performance.now();
const preview = forecastImpact(live, seedBook(), newCandidate({ variantCount: 12, formatCode: 'mAb', definitionId: live.id }), {});
const elapsed = performance.now() - t0;
check('analytical forecast returns in under 20 ms', elapsed < 20, `${elapsed.toFixed(1)} ms`);
check('analytical solver asserts aggregate mode (did not throw)', preview.solverId === 'analytical');

const swapped = forecastImpact(live, seedBook(), newCandidate({ variantCount: 12 }), {}, desStub);
check('AC11 swapping analytical for stub des requires no Layer 0–2 change', swapped.solverId === 'des');

const immediate = cloneDefinition(live);
const hybrid = cloneDefinition(live);
for (const node of hybrid.nodes) {
  if (node.batch.quantum > 1) node.batch.closePolicy = { kind: 'hybrid', fillFraction: 0.8, maxHoldDays: 3 };
}
const fcImm = forecastImpact(immediate, [], newCandidate({ variantCount: 20, consolidate: false }), {});
const fcHyb = forecastImpact(hybrid, [], newCandidate({ variantCount: 20, consolidate: false }), {});
check(
  'AC12 hybrid 0.8 close policy forecasts differently from immediate',
  fcImm.stages.some((s, i) => s.newCycles !== fcHyb.stages[i]?.newCycles) ||
    Math.abs(fcImm.totalQueueDaysAfter - fcHyb.totalQueueDaysAfter) > 1e-6,
  `imm cycles=${fcImm.stages.reduce((n, s) => n + s.newCycles, 0)} hyb=${fcHyb.stages.reduce((n, s) => n + s.newCycles, 0)}`,
);

check('20 constructs into 34 open wells add zero new batch cycles', batchCycles(20, 96, 34, { kind: 'immediate' }).newCycles === 0);
check('1 construct with 0 open wells adds exactly one batch cycle', batchCycles(1, 96, 0, { kind: 'immediate' }).newCycles === 1);

const open = { n4: 34, n5: 34, n10: 8 };
const levers = rankLevers(live, seedBook(), newCandidate({ variantCount: 20, consolidate: false }), open);
check('batch_consolidate ranks first when open wells exist and scope cost is 0', levers[0]?.kind === 'batch_consolidate' && levers[0].scopeCostPct === 0, levers[0]?.kind ?? 'none');

const log = seedLog();
check('ClaimEvent log has visitId and iteration on every visit', log.visits.every((v) => v.visitId && v.iteration === 0) && log.claims.every((c) => c.visitId && c.acquiredAt));

const template = antibodyDefinition('mAb');
const proc = instantiateFromTemplate(template, 'My mAb');
check(
  'instantiateFromTemplate clones with a new process id',
  proc.id !== template.id && proc.label === 'My mAb' && proc.nodes.length === template.nodes.length,
);
validateDefinition(proc);

const twoCells = addWorkcell(proc, { label: 'Expression suite', location: 'B2' });
check('addWorkcell appends a named cell', twoCells.workcells.length === 2 && twoCells.workcells[1].label === 'Expression suite');

const renamedCell = updateWorkcell(twoCells, twoCells.workcells[1].id, { label: 'Expr', calendarId: 'nights' });
check(
  'updateWorkcell edits label and calendar',
  renamedCell.workcells[1].label === 'Expr' && renamedCell.workcells[1].calendarId === 'nights',
);

const moved = assignResource(renamedCell, 'res-10', renamedCell.workcells[1].id);
const exprCell = moved.workcells[1].id;
check('assignResource moves the resource', moved.resources.find((r) => r.id === 'res-10')?.workcellId === exprCell);
check(
  'cross-workcell sequence edges get TransferSpec',
  !!moved.edges.find((e) => e.id === 'e-9')?.transfer && !!moved.edges.find((e) => e.id === 'e-10')?.transfer,
);
validateDefinition(moved);

const dropped = deleteWorkcell(moved, exprCell);
check(
  'deleteWorkcell reassigns resources to the remaining cell',
  dropped.workcells.length === 1 && dropped.resources.every((r) => r.workcellId === dropped.workcells[0].id),
);
check('same-cell sequence no longer carries a transfer', !dropped.edges.find((e) => e.id === 'e-9')?.transfer);
validateDefinition(dropped);

try {
  deleteWorkcell(dropped, dropped.workcells[0].id);
  check('cannot delete the last workcell', false);
} catch (err) {
  check('cannot delete the last workcell', err instanceof DefinitionError);
}

const emptyCell = addWorkcell(dropped);
validateDefinition(emptyCell);
check('empty workcells are allowed', emptyCell.workcells.length === 2 && emptyCell.workcells[1].resourceIds.length === 0);

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
