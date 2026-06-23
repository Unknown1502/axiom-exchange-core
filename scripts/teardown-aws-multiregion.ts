/**
 * Tear down the multi-Region Aurora DSQL cluster provisioned by
 * provision-aws-multiregion.ts. A running multi-Region cluster bills in BOTH
 * Regions plus witness storage, so this exists so you never forget to clean up.
 *
 * Deletion is a two-step dance per the AWS runbook:
 *   1. Disable deletion protection on each cluster (update-cluster).
 *   2. Delete each peered cluster in its own Region (delete-cluster).
 * Deleting one peer moves both to PENDING_DELETE; once both are issued the
 * system validates and transitions them to DELETING automatically.
 *
 * Identifiers are read from env (printed by the provisioning script). Pass them
 * explicitly to avoid deleting the wrong cluster:
 *   DSQL_IDENTIFIER_US, DSQL_REGION_US, DSQL_IDENTIFIER_EU, DSQL_REGION_EU
 *
 * Usage: `npm run teardown:aws:multiregion`
 */

import { config as loadEnv } from 'dotenv';
import {
  DeleteClusterCommand,
  DSQLClient,
  UpdateClusterCommand,
} from '@aws-sdk/client-dsql';

loadEnv();

interface Target {
  region: string;
  identifier: string;
}

function resolveTargets(): Target[] {
  const usId = process.env.DSQL_IDENTIFIER_US;
  const usRegion = process.env.DSQL_REGION_US ?? process.env.DSQL_REGION_PRIMARY ?? 'us-east-1';
  const euId = process.env.DSQL_IDENTIFIER_EU;
  const euRegion = process.env.DSQL_REGION_EU ?? process.env.DSQL_REGION_PEER ?? 'us-east-2';

  if (!usId || !euId) {
    throw new Error(
      'Set DSQL_IDENTIFIER_US and DSQL_IDENTIFIER_EU in .env (printed by the ' +
        'provisioning script) so teardown targets the right clusters.',
    );
  }
  return [
    { region: usRegion, identifier: usId },
    { region: euRegion, identifier: euId },
  ];
}

async function disableProtection(target: Target): Promise<void> {
  const dsql = new DSQLClient({ region: target.region });
  await dsql.send(
    new UpdateClusterCommand({
      identifier: target.identifier,
      deletionProtectionEnabled: false,
    }),
  );
  console.log(`  [${target.region}] deletion protection disabled for ${target.identifier}`);
}

async function deleteCluster(target: Target): Promise<void> {
  const dsql = new DSQLClient({ region: target.region });
  const result = await dsql.send(new DeleteClusterCommand({ identifier: target.identifier }));
  console.log(`  [${target.region}] delete issued for ${target.identifier} (status: ${result.status ?? 'UNKNOWN'})`);
}

async function main(): Promise<void> {
  const targets = resolveTargets();

  console.log('=== AXIOM multi-Region DSQL teardown ===');
  for (const t of targets) console.log(`  will delete: [${t.region}] ${t.identifier}`);
  console.log('');

  // Step 1: disable deletion protection on both (required before delete).
  console.log('Step 1/2 — disable deletion protection');
  for (const t of targets) await disableProtection(t);

  // Step 2: delete both. Order does not matter; both must be issued for the
  // peered pair to actually transition to DELETING.
  console.log('Step 2/2 — delete both peered clusters');
  for (const t of targets) await deleteCluster(t);

  console.log('\nTeardown issued. Both clusters will transition to DELETING shortly.');
  console.log('Remember to also delete the order_events DynamoDB table if no longer needed.');
}

main().catch((err: unknown) => {
  console.error('\nTeardown failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
