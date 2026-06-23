/**
 * Provision a REAL multi-Region Aurora DSQL cluster for AXIOM.
 *
 * This is the infrastructure behind AXIOM's core thesis: ONE strongly consistent
 * ledger of truth, writable from multiple Regions, with zero replication lag. A
 * multi-Region DSQL cluster is two peered Regional clusters (each with its own
 * endpoint) plus a lightweight WITNESS Region that holds no endpoint but
 * participates in the commit quorum. Both endpoints present a single logical
 * database with synchronous, strongly-consistent reads and writes.
 *
 * Topology created here (the AWS-canonical trio):
 *   - Cluster 1 (primary)  : us-east-1   -> labeled "us"  in the demo
 *   - Cluster 2 (peer)     : us-east-2   -> labeled "eu"  in the demo
 *   - Witness (no endpoint) : us-west-2
 *
 * NB: the "eu"/"apac" labels are presentation labels for the demo narrative;
 * us-east-2 is a real, separate Region but it is not literally in Europe. We keep
 * AXIOM's habit of being honest about what is real vs. labeled.
 *
 * IMPORTANT: a standalone (single-Region) cluster CANNOT be upgraded into a
 * multi-Region one. Multi-Region clusters must be CREATED with
 * multiRegionProperties from the start (they sit in PENDING_SETUP until peered).
 * So this script provisions a FRESH pair; the old single-Region cluster from
 * `provision-aws.ts` should be retired separately.
 *
 * Steps (mirrors the AWS CLI runbook, via the SDK so no AWS CLI is needed):
 *   1. create-cluster in Region 1 with {witnessRegion}        -> PENDING_SETUP
 *   2. create-cluster in Region 2 with {witnessRegion, peer1} -> PENDING_SETUP
 *   3. update-cluster Region 1 adding peer2's ARN             -> UPDATING
 *   4. poll both until ACTIVE
 *
 * Credentials resolve via the AWS SDK default provider chain (aws configure or
 * AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY in .env). They are NEVER printed.
 *
 * Usage: `npm run provision:aws:multiregion`
 * Teardown: `npm run teardown:aws:multiregion` (see teardown-aws-multiregion.ts)
 */

import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  CreateClusterCommand,
  DSQLClient,
  GetClusterCommand,
  UpdateClusterCommand,
} from '@aws-sdk/client-dsql';

loadEnv();

// Region trio. Overridable, but defaults to the AWS-canonical multi-Region set.
const REGION_PRIMARY = process.env.DSQL_REGION_PRIMARY ?? 'us-east-1';
const REGION_PEER = process.env.DSQL_REGION_PEER ?? 'us-east-2';
const REGION_WITNESS = process.env.DSQL_REGION_WITNESS ?? 'us-west-2';

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000; // multi-Region creation can take several minutes

interface ProvisionedCluster {
  region: string;
  identifier: string;
  arn: string;
  endpoint: string;
}

function requireCredentials(): void {
  const hasEnv = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  const hasFile = existsSync(join(homedir(), '.aws', 'credentials'));
  if (!hasEnv && !hasFile) {
    throw new Error(
      'No AWS credentials found. Run `aws configure` (recommended) or add ' +
        'AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY to .env. Never paste keys into chat.',
    );
  }
}

function endpointFor(identifier: string, region: string): string {
  return `${identifier}.dsql.${region}.on.aws`;
}

/** Create one Region's cluster with multi-Region properties. */
async function createCluster(
  region: string,
  witnessRegion: string,
  peerArns: string[],
): Promise<{ identifier: string; arn: string }> {
  const dsql = new DSQLClient({ region });
  const created = await dsql.send(
    new CreateClusterCommand({
      deletionProtectionEnabled: true,
      multiRegionProperties: {
        witnessRegion,
        ...(peerArns.length > 0 ? { clusters: peerArns } : {}),
      },
      tags: { Name: `axiom-${region}`, project: 'axiom-hackathon', topology: 'multi-region' },
    }),
  );
  const identifier = created.identifier;
  const arn = created.arn;
  if (!identifier || !arn) {
    throw new Error(`CreateCluster in ${region} did not return identifier/arn.`);
  }
  console.log(`  [${region}] created ${identifier} (status: ${created.status ?? 'UNKNOWN'})`);
  return { identifier, arn };
}

/** Add a peer ARN to an existing cluster, completing the peering link. */
async function peerCluster(
  region: string,
  identifier: string,
  witnessRegion: string,
  peerArns: string[],
): Promise<void> {
  const dsql = new DSQLClient({ region });
  await dsql.send(
    new UpdateClusterCommand({
      identifier,
      multiRegionProperties: { witnessRegion, clusters: peerArns },
    }),
  );
  console.log(`  [${region}] peering ${identifier} -> ${peerArns.join(', ')}`);
}

/** Poll a single cluster until ACTIVE, throwing on any terminal/unexpected state. */
async function waitUntilActive(region: string, identifier: string): Promise<void> {
  const dsql = new DSQLClient({ region });
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const got = await dsql.send(new GetClusterCommand({ identifier }));
    const status = got.status ?? 'UNKNOWN';
    console.log(`  [${region}] ${identifier}: ${status}`);
    if (status === 'ACTIVE') return;
    if (status === 'FAILED' || status === 'DELETING' || status === 'DELETED') {
      throw new Error(`[${region}] cluster ${identifier} entered terminal status: ${status}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`[${region}] cluster ${identifier} did not reach ACTIVE within timeout.`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function main(): Promise<void> {
  requireCredentials();

  console.log('=== AXIOM multi-Region Aurora DSQL provisioning ===');
  console.log(`  primary : ${REGION_PRIMARY}  (demo label "us")`);
  console.log(`  peer    : ${REGION_PEER}  (demo label "eu")`);
  console.log(`  witness : ${REGION_WITNESS}  (no endpoint; commit quorum only)\n`);

  // Step 1: create the primary with witness but no peer yet (PENDING_SETUP).
  console.log('Step 1/4 — create primary cluster');
  const primary = await createCluster(REGION_PRIMARY, REGION_WITNESS, []);

  // Step 2: create the peer, already pointing at the primary's ARN.
  console.log('Step 2/4 — create peer cluster (linked to primary)');
  const peer = await createCluster(REGION_PEER, REGION_WITNESS, [primary.arn]);

  // Step 3: update the primary to point back at the peer, completing the link.
  console.log('Step 3/4 — peer primary back to peer cluster');
  await peerCluster(REGION_PRIMARY, primary.identifier, REGION_WITNESS, [peer.arn]);

  // Step 4: both transition PENDING_SETUP -> CREATING -> ACTIVE once linked.
  console.log('Step 4/4 — waiting for both clusters to reach ACTIVE');
  await Promise.all([
    waitUntilActive(REGION_PRIMARY, primary.identifier),
    waitUntilActive(REGION_PEER, peer.identifier),
  ]);

  const provisioned: ProvisionedCluster[] = [
    {
      region: REGION_PRIMARY,
      identifier: primary.identifier,
      arn: primary.arn,
      endpoint: endpointFor(primary.identifier, REGION_PRIMARY),
    },
    {
      region: REGION_PEER,
      identifier: peer.identifier,
      arn: peer.arn,
      endpoint: endpointFor(peer.identifier, REGION_PEER),
    },
  ];

  console.log('\n=== PROVISIONING COMPLETE — multi-Region cluster ACTIVE ===');
  console.log('Add these to your .env, then run `npm run db:migrate:dsql:multiregion`:\n');
  console.log(`  DSQL_ENDPOINT_US=${provisioned[0]!.endpoint}`);
  console.log(`  DSQL_REGION_US=${REGION_PRIMARY}`);
  console.log(`  DSQL_ENDPOINT_EU=${provisioned[1]!.endpoint}`);
  console.log(`  DSQL_REGION_EU=${REGION_PEER}`);
  console.log(`  DSQL_WITNESS_REGION=${REGION_WITNESS}\n`);
  console.log('Cluster identifiers (needed for teardown):');
  console.log(`  ${REGION_PRIMARY}: ${provisioned[0]!.identifier}`);
  console.log(`  ${REGION_PEER}: ${provisioned[1]!.identifier}`);
  console.log('\nTeardown when done: `npm run teardown:aws:multiregion`');
}

main().catch((err: unknown) => {
  console.error('\nMulti-Region provisioning failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
