import { cloneDefinition, occupancyResource, nodeById, workcellOf } from './validate';
import { DefinitionError, type ProcessDefinition, type Workcell } from './types';

function uniqueId(existing: string[], prefix: string): string {
  let n = existing.length + 1;
  let id = `${prefix}-${n}`;
  while (existing.includes(id)) {
    n += 1;
    id = `${prefix}-${n}`;
  }
  return id;
}

export function instantiateFromTemplate(template: ProcessDefinition, label: string): ProcessDefinition {
  const next = cloneDefinition(template);
  next.id = `proc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  next.label = label.trim() || template.label;
  return next;
}

export function syncResourceIndex(def: ProcessDefinition): void {
  for (const cell of def.workcells) {
    cell.resourceIds = def.resources.filter((r) => r.workcellId === cell.id).map((r) => r.id);
  }
}

export function syncTransfers(def: ProcessDefinition): void {
  for (const edge of def.edges) {
    if (edge.kind !== 'sequence') continue;
    const fromNode = nodeById(def, edge.from);
    const toNode = nodeById(def, edge.to);
    if (!fromNode || !toNode) continue;
    const fromRes = occupancyResource(fromNode);
    const toRes = occupancyResource(toNode);
    if (!fromRes || !toRes) continue;
    const fromCell = workcellOf(def, fromRes);
    const toCell = workcellOf(def, toRes);
    if (fromCell && toCell && fromCell !== toCell) {
      if (!edge.transfer) {
        edge.transfer = {
          fromWorkcellId: fromCell,
          toWorkcellId: toCell,
          transportResourceId: null,
          durationDays: 0,
          batchQuantum: 1,
          maxQueueDays: null,
          holdsSourceUntilArrival: false,
        };
      } else {
        edge.transfer.fromWorkcellId = fromCell;
        edge.transfer.toWorkcellId = toCell;
      }
    } else if (edge.transfer && fromCell === toCell) {
      delete edge.transfer;
    }
  }
}

export function addWorkcell(
  def: ProcessDefinition,
  partial?: { label?: string; location?: string; calendarId?: string },
): ProcessDefinition {
  const next = cloneDefinition(def);
  const id = uniqueId(next.workcells.map((c) => c.id), 'wc');
  const cell: Workcell = {
    id,
    label: partial?.label?.trim() || `Workcell ${next.workcells.length + 1}`,
    resourceIds: [],
    calendarId: partial?.calendarId?.trim() || 'lab-default',
  };
  if (partial?.location?.trim()) cell.location = partial.location.trim();
  next.workcells.push(cell);
  return next;
}

export function updateWorkcell(
  def: ProcessDefinition,
  workcellId: string,
  patch: { label?: string; location?: string; calendarId?: string },
): ProcessDefinition {
  const next = cloneDefinition(def);
  const cell = next.workcells.find((c) => c.id === workcellId);
  if (!cell) throw new DefinitionError(`Unknown workcell ${workcellId}`);
  if (patch.label != null) cell.label = patch.label.trim() || cell.label;
  if (patch.calendarId != null) cell.calendarId = patch.calendarId.trim() || 'lab-default';
  if (patch.location != null) {
    const loc = patch.location.trim();
    if (loc) cell.location = loc;
    else delete cell.location;
  }
  return next;
}

export function assignResource(def: ProcessDefinition, resourceId: string, workcellId: string): ProcessDefinition {
  const next = cloneDefinition(def);
  const resource = next.resources.find((r) => r.id === resourceId);
  const cell = next.workcells.find((c) => c.id === workcellId);
  if (!resource) throw new DefinitionError(`Unknown resource ${resourceId}`);
  if (!cell) throw new DefinitionError(`Unknown workcell ${workcellId}`);
  resource.workcellId = workcellId;
  resource.calendarId = cell.calendarId;
  syncResourceIndex(next);
  syncTransfers(next);
  return next;
}

export function deleteWorkcell(def: ProcessDefinition, workcellId: string): ProcessDefinition {
  const next = cloneDefinition(def);
  if (next.workcells.length <= 1) {
    throw new DefinitionError('A process needs at least one workcell');
  }
  const fallback = next.workcells.find((c) => c.id !== workcellId);
  if (!fallback) throw new DefinitionError('A process needs at least one workcell');
  for (const resource of next.resources) {
    if (resource.workcellId === workcellId) {
      resource.workcellId = fallback.id;
      resource.calendarId = fallback.calendarId;
    }
  }
  next.workcells = next.workcells.filter((c) => c.id !== workcellId);
  syncResourceIndex(next);
  syncTransfers(next);
  return next;
}

export function renameProcess(def: ProcessDefinition, label: string): ProcessDefinition {
  const next = cloneDefinition(def);
  next.label = label.trim() || next.label;
  return next;
}
