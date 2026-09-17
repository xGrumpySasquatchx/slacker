export type TopologyProfile = 'serial' | 'cyclic' | 'fanout' | 'convergent' | 'per_unit' | 'mixed';
export type ClaimRole = 'occupancy' | 'effort' | 'transport' | 'gate';
export type DeadlockPolicy = 'ordered' | 'preallocate' | 'bounded_admission';
export type ActorClass = 'human' | 'robot' | 'instrument' | 'in_silico' | 'vendor';
export type EdgeKind = 'sequence' | 'iterate' | 'fanout' | 'join';
export type BatchCloseKind = 'immediate' | 'fill_threshold' | 'time_threshold' | 'hybrid';
export type ExpansionMode = 'aggregate' | 'enumerated';
export type SolverId = 'analytical' | 'des' | 'scheduler' | 'optimizer';
export type CommitmentHardness = 'contractual' | 'internal' | 'soft';
export type WorkStatus = 'proposed' | 'committed' | 'in_flight' | 'complete' | 'declined' | 'deferred';
export type ForecastVerdict = 'fits_within_slack' | 'breaches_ceiling' | 'infeasible';
export type LeverKind = 'batch_consolidate' | 'trim_scope' | 'defer_start' | 'reduce_fanout';
export type VisitOutcome = 'pass' | 'loss_fail' | 'not_selected' | 'repeat';

export interface BatchClosePolicy {
  kind: BatchCloseKind;
  fillFraction?: number;
  maxHoldDays?: number;
}

export interface ClaimTemplate {
  resourceId: string;
  role: ClaimRole;
  acquireAtOffset: number;
  releaseAtOffset: number;
  quantity: number;
  exclusive: boolean;
  acquireOrder: number;
}

export interface ResourceClaim {
  visitId: string;
  resourceId: string;
  role: ClaimRole;
  acquireAtOffset: number;
  releaseAtOffset: number;
  quantity: number;
  exclusive: boolean;
  acquireOrder: number;
}

export interface Workcell {
  id: string;
  label: string;
  resourceIds: string[];
  calendarId: string;
  location?: string;
}

export interface TransferSpec {
  fromWorkcellId: string;
  toWorkcellId: string;
  transportResourceId: string | null;
  durationDays: number;
  batchQuantum: number;
  maxQueueDays: number | null;
  holdsSourceUntilArrival: boolean;
}

export interface Resource {
  id: string;
  name: string;
  actorClass: ActorClass;
  workcellId: string;
  cyclesPerPeriod: number;
  periodDays: number;
  availability: number;
  batchQuantum: number;
  setupDays: number;
  unitDays: number;
  teDays: number;
  targetUtilizationCeiling: number;
  cs2: number;
  calendarId: string;
  seedRho: number;
}

export interface ProcessNode {
  id: string;
  label: string;
  unitLoad: number;
  yieldRate: number;
  reworkProbability: number;
  reworkTargetNodeId: string | null;
  maxReworkPasses: number;
  batch: { quantum: number; closePolicy: BatchClosePolicy };
  claims: ClaimTemplate[];
  campaignGated?: boolean;
}

export interface ProcessEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  multiplicity?: number;
  expectedIterations?: number;
  transfer?: TransferSpec;
}

export interface ProcessDefinition {
  id: string;
  label: string;
  topologyProfile: TopologyProfile;
  deadlockPolicy: DeadlockPolicy;
  workcells: Workcell[];
  resources: Resource[];
  nodes: ProcessNode[];
  edges: ProcessEdge[];
  ca2Seed: number;
  horizonDays: number;
}

export interface Visit {
  visitId: string;
  nodeId: string;
  iteration: number;
  predecessorVisitIds: string[];
}

export interface RoutedUnit {
  unitId: string;
  cohortId: string;
  visits: Visit[];
}

export interface Expansion {
  mode: ExpansionMode;
  demandByNode: Map<string, number>;
  flowByNode: Map<string, number>;
  units?: RoutedUnit[];
  sampled?: { enumerated: number; represents: number };
}

export interface ResourceCycle {
  resourceIds: string[];
}

export interface WorkItem {
  id: string;
  label: string;
  definitionId: string;
  formatCode: string;
  variantCount: number;
  requestedStart: string;
  dueDate: string | null;
  hardness: CommitmentHardness;
  priorityClass: number;
  status: WorkStatus;
  acceptedForecastId: string | null;
  consolidate: boolean;
}

export interface StageImpact {
  nodeId: string;
  label: string;
  resourceId: string;
  role: ClaimRole;
  rhoBefore: number;
  rhoAfter: number;
  ceiling: number;
  breachesCeiling: boolean;
  waitMultiplierBefore: number;
  waitMultiplierAfter: number;
  waitDaysBefore: number;
  waitDaysAfter: number;
  deltaDays: number;
  shareOfTotalDelta: number;
  openBatchCapacity: number;
  infeasible: boolean;
  teDays: number;
  ca2: number;
  cs2: number;
  newCycles: number;
  absorbedUnits: number;
  campaignGated: boolean;
  windowFillBefore?: number;
  windowFillAfter?: number;
  blockingExposed: boolean;
  sampled: boolean;
}

export interface ScheduleImpact {
  workItemId: string;
  label: string;
  hardness: CommitmentHardness;
  completionBefore: string;
  completionAfter: string;
  slipDays: number;
}

export interface Lever {
  kind: LeverKind;
  label: string;
  detail: string;
  slackRecoveredPct: number;
  scopeCostPct: number;
  daysRecovered: number;
  efficiency: number;
  apply: () => WorkItem;
}

export interface AccuracySummary {
  windowSize: number;
  medianAbsPctError: number;
  p80CoverageRate: number;
  lastRefitAt: string;
}

export interface ImpactForecast {
  forecastId: string;
  solverId: SolverId;
  candidate: WorkItem;
  verdict: ForecastVerdict;
  stages: StageImpact[];
  bindingNodeId: string;
  scheduleImpacts: ScheduleImpact[];
  candidateCycleTime: { p50: number; p80: number; p95: number };
  totalQueueDaysBefore: number;
  totalQueueDaysAfter: number;
  levers: Lever[];
  modelAccuracy: AccuracySummary;
  computedAt: string;
  designedConstructs: number;
  yieldAmplification: number;
  deadlockCycles: ResourceCycle[];
  blockingExposed: boolean;
  sampled: boolean;
}

export interface VisitEvent {
  workUnitId: string;
  cohortId: string;
  visitId: string;
  nodeId: string;
  iteration: number;
  workcellId: string;
  batchId: string | null;
  enqueuedAt: string;
  startedAt: string;
  completedAt: string;
  outcome: VisitOutcome;
}

export interface ClaimEvent {
  visitId: string;
  resourceId: string;
  role: ClaimRole;
  requestedAt: string;
  acquiredAt: string;
  releasedAt: string;
  quantity: number;
}

export interface DeclinedWorkRecord {
  workItem: WorkItem;
  forecastId: string;
  bindingNodeId: string;
  reason: 'declined' | 'deferred' | 'trimmed';
  scopeReductionPct: number;
  decidedBy: string;
  decidedAt: string;
}

export type OpenCapacity = Record<string, number>;

export interface SolverContext {
  definition: ProcessDefinition;
  expansion: Expansion;
  claims: ResourceClaim[];
  baseline: WorkItem[];
  candidate: WorkItem;
  openCapacity: OpenCapacity;
  deadlockCycles: ResourceCycle[];
}

export interface Solver {
  id: SolverId;
  requiredMode: ExpansionMode;
  run: (ctx: SolverContext) => Omit<ImpactForecast, 'levers' | 'deadlockCycles' | 'sampled'>;
}

export class DefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DefinitionError';
  }
}
