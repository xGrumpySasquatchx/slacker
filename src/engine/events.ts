import type { ClaimEvent, VisitEvent } from './types';

export interface EventLog {
  visits: VisitEvent[];
  claims: ClaimEvent[];
}

export function emptyLog(): EventLog {
  return { visits: [], claims: [] };
}

/** Seeded calibration window so the surface is never empty. visitId + iteration are present from day one. */
export function seedLog(): EventLog {
  const visits: VisitEvent[] = [];
  const claims: ClaimEvent[] = [];
  for (let i = 0; i < 20; i++) {
    const day = String(i + 1).padStart(2, '0');
    const visitId = `hist-n10-${i}`;
    visits.push({
      workUnitId: `wu-${i}`,
      cohortId: 'HER2-001',
      visitId,
      nodeId: 'n10',
      iteration: 0,
      workcellId: 'wc-ab',
      batchId: `B-${Math.floor(i / 24)}`,
      enqueuedAt: `2026-07-${day}T08:00:00Z`,
      startedAt: `2026-07-${day}T10:00:00Z`,
      completedAt: `2026-07-${day}T16:00:00Z`,
      outcome: i % 9 === 0 ? 'loss_fail' : 'pass',
    });
    claims.push({
      visitId,
      resourceId: 'res-10',
      role: 'occupancy',
      requestedAt: `2026-07-${String(day).padStart(2, '0')}T08:00:00Z`,
      acquiredAt: `2026-07-${String(day).padStart(2, '0')}T10:00:00Z`,
      releasedAt: `2026-07-${String(day + 5).padStart(2, '0')}T16:00:00Z`,
      quantity: 1,
    });
  }
  return { visits, claims };
}

export function appendAcceptance(log: EventLog, visits: VisitEvent[], claims: ClaimEvent[]): EventLog {
  return { visits: [...visits, ...log.visits], claims: [...claims, ...log.claims] };
}

export function observedQueueDays(log: EventLog): number {
  if (!log.claims.length) return 0;
  const waits = log.claims.map((c) => (Date.parse(c.acquiredAt) - Date.parse(c.requestedAt)) / 86_400_000);
  waits.sort((a, b) => a - b);
  return waits[Math.floor(waits.length / 2)] ?? 0;
}
