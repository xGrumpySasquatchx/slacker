import type { StageImpact } from './types';

export function rankBottlenecks(stages: StageImpact[]): StageImpact[] {
  return [...stages]
    .filter((s) => !s.campaignGated)
    .sort((a, b) => b.shareOfTotalDelta - a.shareOfTotalDelta);
}

export function bindingStage(stages: StageImpact[]): StageImpact | undefined {
  const ranked = rankBottlenecks(stages);
  const infeasible = stages.find((s) => s.infeasible);
  return infeasible ?? ranked[0] ?? stages[0];
}
