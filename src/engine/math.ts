export function waitMultiplier(rho: number): number {
  if (rho >= 1) return Number.POSITIVE_INFINITY;
  if (rho <= 0) return 0;
  return rho / (1 - rho);
}

export function kingmanWq(rho: number, te: number, ca2: number, cs2: number): number {
  if (rho >= 1) return Number.POSITIVE_INFINITY;
  return ((ca2 + cs2) / 2) * waitMultiplier(rho) * te;
}

export function clampRho(rho: number): number {
  if (rho < 0) return 0;
  if (rho >= 1) return 0.99;
  return rho;
}

/** Union length of [start, end) intervals. Overlap is counted once. */
export function unionLength(intervals: { start: number; end: number }[]): number {
  const parts = intervals
    .map((i) => ({ start: i.start, end: Math.max(i.start, i.end) }))
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  if (!parts.length) return 0;
  let total = 0;
  let lo = parts[0].start;
  let hi = parts[0].end;
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].start <= hi) {
      hi = Math.max(hi, parts[i].end);
    } else {
      total += hi - lo;
      lo = parts[i].start;
      hi = parts[i].end;
    }
  }
  return total + (hi - lo);
}

export function batchCycles(
  units: number,
  quantum: number,
  openBatchCapacity: number,
  policy: { kind: string; fillFraction?: number; maxHoldDays?: number },
): { newCycles: number; absorbedUnits: number; heldUnits: number } {
  const q = Math.max(1, quantum);
  const absorbedUnits = Math.min(Math.max(0, units), Math.max(0, openBatchCapacity));
  const spill = Math.max(0, units - absorbedUnits);
  if (policy.kind === 'immediate' || policy.kind === 'time_threshold') {
    return { newCycles: Math.ceil(spill / q), absorbedUnits, heldUnits: 0 };
  }
  const fill = policy.fillFraction ?? 1;
  const closeAt = Math.max(1, Math.ceil(q * fill));
  const full = Math.floor(spill / closeAt);
  const remainder = spill - full * closeAt;
  if (policy.kind === 'hybrid' && policy.maxHoldDays != null && remainder > 0) {
    return { newCycles: full + 1, absorbedUnits, heldUnits: 0 };
  }
  return { newCycles: full + (remainder >= closeAt ? 1 : 0), absorbedUnits, heldUnits: remainder };
}
