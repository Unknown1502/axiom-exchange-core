/**
 * Region tagging.
 *
 * Resolves the originating region for an order from (in priority order) the
 * request body, the `X-Region` header (set by the regional Edge route), then
 * the DEMO_REGION env default. This is how labeled-region requests simulate
 * multi-region intake (per the scope-cut plan) while remaining honest: the
 * value is recorded as `region_origin` on the order and the firehose event.
 */

import type { FastifyRequest } from 'fastify';
import type { Region } from '@axiom/shared-types';
import { normalizeRegion } from '../regions.js';

export function resolveRegion(request: FastifyRequest, bodyRegion: string | undefined): Region {
  const header = request.headers['x-region'];
  const headerValue = Array.isArray(header) ? header[0] : header;
  return normalizeRegion(bodyRegion ?? headerValue ?? process.env.DEMO_REGION);
}
