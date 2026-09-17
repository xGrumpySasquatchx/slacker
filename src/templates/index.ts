import { antibodyDefinition, FORMAT_CODES, type FormatCode } from './antibody';
import { convergentDefinition, fanoutDefinition, perUnitDefinition, strainDefinition } from './catalog';
import type { ProcessDefinition } from '../engine/types';

export { antibodyDefinition, FORMAT_CODES, FORMAT_LABEL, yieldOnlyAntibody, type FormatCode } from './antibody';
export { convergentDefinition, deadlockFixture, fanoutDefinition, perUnitDefinition, strainDefinition, unionEffortDefinition } from './catalog';

export const CATALOG: ProcessDefinition[] = [
  antibodyDefinition('mAb'),
  strainDefinition(),
  fanoutDefinition(),
  convergentDefinition(),
  perUnitDefinition(),
];

export function definitionById(id: string): ProcessDefinition {
  if (id.startsWith('antibody-')) {
    const rest = id.replace('antibody-', '');
    const format = (FORMAT_CODES as readonly string[]).includes(rest) ? (rest as FormatCode) : 'mAb';
    return antibodyDefinition(format);
  }
  return CATALOG.find((d) => d.id === id) ?? CATALOG[0];
}
