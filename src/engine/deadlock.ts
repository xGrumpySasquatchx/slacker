import type { ResourceClaim, ResourceCycle } from './types';

interface Edge {
  from: string;
  to: string;
}

function cyclesFrom(edges: Edge[]): ResourceCycle[] {
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.from === e.to) continue;
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    adj.get(e.from)!.add(e.to);
  }
  const found: ResourceCycle[] = [];
  const stack: string[] = [];
  const onStack = new Set<string>();
  const vis = new Set<string>();

  const dfs = (id: string) => {
    vis.add(id);
    onStack.add(id);
    stack.push(id);
    for (const nxt of adj.get(id) ?? []) {
      if (!vis.has(nxt)) dfs(nxt);
      else if (onStack.has(nxt)) {
        const idx = stack.indexOf(nxt);
        found.push({ resourceIds: [...stack.slice(idx), nxt] });
      }
    }
    stack.pop();
    onStack.delete(id);
  };

  for (const id of adj.keys()) if (!vis.has(id)) dfs(id);
  const key = (c: ResourceCycle) => [...c.resourceIds].sort().join('>');
  const unique = new Map<string, ResourceCycle>();
  for (const cycle of found) unique.set(key(cycle), cycle);
  return [...unique.values()];
}

/** Static hold-and-wait graph. An edge R1 → R2 means some visit holds R1 while acquiring R2. */
export function detectPotentialDeadlock(claims: ResourceClaim[]): ResourceCycle[] {
  const byVisit = new Map<string, ResourceClaim[]>();
  for (const claim of claims) {
    const list = byVisit.get(claim.visitId) ?? [];
    list.push(claim);
    byVisit.set(claim.visitId, list);
  }
  const edges: Edge[] = [];
  for (const group of byVisit.values()) {
    const ordered = [...group].sort((a, b) => a.acquireAtOffset - b.acquireAtOffset || a.acquireOrder - b.acquireOrder);
    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const held = ordered[i];
        const next = ordered[j];
        if (held.resourceId === next.resourceId) continue;
        if (held.releaseAtOffset > next.acquireAtOffset) {
          edges.push({ from: held.resourceId, to: next.resourceId });
        }
      }
    }
  }
  return cyclesFrom(edges);
}
