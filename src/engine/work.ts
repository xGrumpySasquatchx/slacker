import type { WorkItem } from './types';

export function cloneWork(item: WorkItem): WorkItem {
  return { ...item };
}

export function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addIsoDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function newCandidate(partial?: Partial<WorkItem>): WorkItem {
  return {
    id: `PRJ-${String(Date.now()).slice(-4)}`,
    label: 'New panel',
    definitionId: 'antibody-mAb',
    formatCode: 'mAb',
    variantCount: 4,
    requestedStart: isoToday(),
    dueDate: null,
    hardness: 'soft',
    priorityClass: 4,
    status: 'proposed',
    acceptedForecastId: null,
    consolidate: false,
    ...partial,
  };
}

export function seedBook(): WorkItem[] {
  return [
    newCandidate({
      id: 'PRJ-2201',
      label: 'HER2 panel (booked)',
      definitionId: 'antibody-mAb',
      formatCode: 'mAb',
      variantCount: 48,
      status: 'committed',
      hardness: 'internal',
    }),
  ];
}

export function seedOpenCapacity(): Record<string, number> {
  return {
    n4: 40,
    n5: 40,
    n6: 40,
    n7: 40,
    n8: 40,
    n9: 40,
    n10: 16,
    n12: 6,
    n13: 6,
    n14: 16,
    n15: 24,
  };
}
