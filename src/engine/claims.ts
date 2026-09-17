import type { Expansion, ProcessDefinition, ResourceClaim } from './types';

export function materializeClaims(def: ProcessDefinition, expansion: Expansion): ResourceClaim[] {
  const claims: ResourceClaim[] = [];
  if (expansion.mode === 'enumerated' && expansion.units) {
    for (const unit of expansion.units) {
      for (const visit of unit.visits) {
        const node = def.nodes.find((n) => n.id === visit.nodeId);
        if (!node) continue;
        for (const template of node.claims) {
          claims.push({ ...template, visitId: visit.visitId });
        }
      }
    }
    return claims;
  }

  for (const node of def.nodes) {
    const demand = expansion.demandByNode.get(node.id) ?? 0;
    const visitId = `agg:${node.id}`;
    for (const template of node.claims) {
      claims.push({
        ...template,
        visitId,
        quantity: template.quantity * demand,
      });
    }
  }
  return claims;
}
