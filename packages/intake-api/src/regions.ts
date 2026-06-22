/**
 * Region metadata and normalization.
 *
 * The order book stores compact region codes (`us` / `eu` / `apac`, enforced by
 * a DB CHECK constraint). The DynamoDB firehose and the UI display the
 * corresponding AWS region names and flags. This module is the single mapping
 * between the two representations.
 */

import type { Region } from '@axiom/shared-types';

export interface RegionMeta {
  code: Region;
  aws: string;
  flag: string;
  label: string;
}

export const REGION_META: Record<Region, RegionMeta> = {
  us: { code: 'us', aws: 'us-east-1', flag: '🇺🇸', label: 'us-east-1' },
  eu: { code: 'eu', aws: 'eu-west-1', flag: '🇪🇺', label: 'eu-west-1' },
  apac: { code: 'apac', aws: 'ap-southeast-1', flag: '🌏', label: 'ap-southeast-1' },
};

const AWS_TO_CODE: Record<string, Region> = {
  'us-east-1': 'us',
  'eu-west-1': 'eu',
  'ap-southeast-1': 'apac',
};

/** Accept either a region code (`us`) or an AWS region (`us-east-1`); default `us`. */
export function normalizeRegion(input: string | undefined): Region {
  if (!input) {
    return 'us';
  }
  const lower = input.toLowerCase();
  if (lower === 'us' || lower === 'eu' || lower === 'apac') {
    return lower;
  }
  return AWS_TO_CODE[lower] ?? 'us';
}

export function awsRegionFor(code: Region): string {
  return REGION_META[code].aws;
}
