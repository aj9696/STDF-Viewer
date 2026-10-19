import { invalid } from './viewer-model.js';

/** Report-only device scope. Never changes saved workspace selections. */
export function reportDeviceOutcomes(value = 'all') {
  if (!['all', 'non-failed', 'pass'].includes(value)) invalid('Choose all devices, exclude failed devices, or passing devices only.');
  return value;
}

export function deviceOutcomeWhere(mode, alias = 'd') {
  if (mode === 'non-failed') return `(${alias}.part_flags IS NULL OR (${alias}.part_flags&28)!=8)`;
  if (mode === 'pass') return `(${alias}.part_flags&28)=0`;
  return '1';
}

export function reportPopulationText(mode = 'all') {
  return mode === 'non-failed'
    ? 'Failed device attempts excluded. Passing and unknown device outcomes retained.'
    : mode === 'pass' ? 'Only device attempts with a known passing outcome retained. Failed and unknown outcomes excluded.'
      : 'All device outcomes retained.';
}
