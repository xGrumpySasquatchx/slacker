import { DefinitionError, type ProcessDefinition, type ProcessNode, type Resource } from './types';

export function nodeById(def: ProcessDefinition, id: string): ProcessNode | undefined {
  return def.nodes.find((n) => n.id === id);
}

export function resourceById(def: ProcessDefinition, id: string): Resource | undefined {
  return def.resources.find((r) => r.id === id);
}

export function workcellOf(def: ProcessDefinition, resourceId: string): string | undefined {
  return resourceById(def, resourceId)?.workcellId;
}

export function outgoing(def: ProcessDefinition, nodeId: string) {
  return def.edges.filter((e) => e.from === nodeId);
}

export function incoming(def: ProcessDefinition, nodeId: string) {
  return def.edges.filter((e) => e.to === nodeId);
}

export function occupancyResource(node: ProcessNode): string | undefined {
  return node.claims.find((c) => c.role === 'occupancy')?.resourceId ?? node.claims[0]?.resourceId;
}

function hasCycleWithoutBound(def: ProcessDefinition): boolean {
  const iterate = def.edges.filter((e) => e.kind === 'iterate');
  if (!iterate.length) {
    const nodes = new Map(def.nodes.map((n) => [n.id, outgoing(def, n.id).map((e) => e.to)]));
    const vis = new Map<string, 0 | 1 | 2>();
    const dfs = (id: string): boolean => {
      vis.set(id, 1);
      for (const nxt of nodes.get(id) ?? []) {
        const st = vis.get(nxt) ?? 0;
        if (st === 1) return true;
        if (st === 0 && dfs(nxt)) return true;
      }
      vis.set(id, 2);
      return false;
    };
    return def.nodes.some((n) => (vis.get(n.id) ?? 0) === 0 && dfs(n.id));
  }
  return iterate.some((e) => e.expectedIterations == null || e.expectedIterations <= 0);
}

export function validateDefinition(def: ProcessDefinition): void {
  if (!def.nodes.length) throw new DefinitionError('Definition has no nodes');
  if (!def.workcells.length) throw new DefinitionError('Definition needs at least one workcell');

  const nodeIds = new Set(def.nodes.map((n) => n.id));
  const resIds = new Set(def.resources.map((r) => r.id));
  const cellIds = new Set(def.workcells.map((w) => w.id));

  for (const resource of def.resources) {
    if (!cellIds.has(resource.workcellId)) {
      throw new DefinitionError(`Resource ${resource.id} references missing workcell ${resource.workcellId}`);
    }
  }

  if (def.topologyProfile === 'per_unit') {
    for (const node of def.nodes) {
      if (node.batch.quantum !== 1) {
        throw new DefinitionError(`per_unit requires batch.quantum === 1 (${node.id} is ${node.batch.quantum})`);
      }
    }
  }

  if (def.topologyProfile === 'cyclic' || def.topologyProfile === 'mixed') {
    const iterate = def.edges.filter((e) => e.kind === 'iterate');
    if (!iterate.length && def.topologyProfile === 'cyclic') {
      throw new DefinitionError('cyclic profile requires at least one iterate edge');
    }
    for (const edge of iterate) {
      if (edge.expectedIterations == null || edge.expectedIterations <= 0) {
        throw new DefinitionError(`iterate edge ${edge.id} lacks expectedIterations`);
      }
    }
  }

  if (hasCycleWithoutBound(def) && !def.edges.some((e) => e.kind === 'iterate' && (e.expectedIterations ?? 0) > 0)) {
    throw new DefinitionError('Unbounded cycle rejected at load time');
  }

  for (const edge of def.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new DefinitionError(`Edge ${edge.id} references a missing node`);
    }
    const fromRes = occupancyResource(nodeById(def, edge.from)!);
    const toRes = occupancyResource(nodeById(def, edge.to)!);
    if (!fromRes || !toRes) continue;
    const fromCell = workcellOf(def, fromRes);
    const toCell = workcellOf(def, toRes);
    if (edge.kind === 'sequence' && fromCell && toCell && fromCell !== toCell && !edge.transfer) {
      throw new DefinitionError(`sequence ${edge.id} crosses workcells without a TransferSpec`);
    }
    if (edge.transfer) {
      if (!cellIds.has(edge.transfer.fromWorkcellId) || !cellIds.has(edge.transfer.toWorkcellId)) {
        throw new DefinitionError(`TransferSpec on ${edge.id} references a missing workcell`);
      }
    }
  }

  for (const node of def.nodes) {
    for (const claim of node.claims) {
      if (!resIds.has(claim.resourceId)) {
        throw new DefinitionError(`Node ${node.id} claims missing resource ${claim.resourceId}`);
      }
      if (claim.releaseAtOffset < claim.acquireAtOffset) {
        throw new DefinitionError(`Node ${node.id} has a claim that releases before it acquires`);
      }
    }
    if (node.reworkTargetNodeId && !nodeIds.has(node.reworkTargetNodeId)) {
      throw new DefinitionError(`Node ${node.id} rework target is missing`);
    }
  }
}

export function cloneDefinition(def: ProcessDefinition): ProcessDefinition {
  return structuredClone(def);
}
