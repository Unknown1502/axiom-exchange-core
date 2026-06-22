import type { RegionCode } from './types';

export interface RegionInfo {
  code: RegionCode;
  aws: string;
  flag: string;
  label: string;
}

export const REGIONS: readonly RegionInfo[] = [
  { code: 'us', aws: 'us-east-1', flag: '🇺🇸', label: 'us-east-1' },
  { code: 'eu', aws: 'eu-west-1', flag: '🇪🇺', label: 'eu-west-1' },
  { code: 'apac', aws: 'ap-southeast-1', flag: '🌏', label: 'ap-southeast-1' },
];

export function regionByCode(code: string): RegionInfo {
  return REGIONS.find((r) => r.code === code) ?? REGIONS[0];
}

export function regionByAws(aws: string): RegionInfo | undefined {
  return REGIONS.find((r) => r.aws === aws);
}

/** Resolve either a code (`us`) or an AWS name (`us-east-1`) to display info. */
export function resolveRegion(value: string): RegionInfo {
  return regionByAws(value) ?? regionByCode(value);
}
