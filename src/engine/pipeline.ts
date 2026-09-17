import { analyticalSolver } from './analytical';
import { materializeClaims } from './claims';
import { detectPotentialDeadlock } from './deadlock';
import { expand } from './expand';
import { rankLevers } from './levers';
import { validateDefinition } from './validate';
import type {
  ImpactForecast,
  OpenCapacity,
  ProcessDefinition,
  Solver,
  WorkItem,
} from './types';

/**
 * Spine → solver. Layers 0–2 do not know which solver is plugged in.
 * The analytical solver must never receive enumerated expansion.
 */
export function forecastImpact(
  def: ProcessDefinition,
  baseline: WorkItem[],
  candidate: WorkItem,
  openCapacity: OpenCapacity,
  solver: Solver = analyticalSolver,
): ImpactForecast {
  validateDefinition(def);
  const booked = Math.max(
    baseline.filter((i) => i.status === 'committed' || i.status === 'in_flight').reduce((s, i) => s + i.variantCount, 0) +
      candidate.variantCount,
    candidate.variantCount,
  );
  const expansion = expand(def, booked, solver.requiredMode, candidate.id);
  const claims = materializeClaims(def, expansion);
  const deadlockCycles = detectPotentialDeadlock(claims);
  const core = solver.run({
    definition: def,
    expansion,
    claims,
    baseline,
    candidate,
    openCapacity,
    deadlockCycles,
  });
  return {
    ...core,
    levers: rankLevers(def, baseline, candidate, openCapacity),
    deadlockCycles,
    sampled: !!expansion.sampled,
  };
}
