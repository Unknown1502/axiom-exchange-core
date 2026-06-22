/**
 * Provision real AWS resources for AXIOM using the AWS SDK (no AWS CLI needed):
 *   1. An Aurora DSQL cluster (waits until ACTIVE).
 *   2. The `order_events` DynamoDB table (PAY_PER_REQUEST).
 *
 * Credentials are resolved via the AWS SDK default provider chain: either
 * `aws configure` (~/.aws/credentials) or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY
 * in .env. They are NEVER printed.
 *
 * Usage: `npm run provision:aws`
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
} from '@aws-sdk/client-dsql';
import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';

loadEnv();

const region = process.env.AWS_REGION ?? 'us-east-1';
const tableName = process.env.DYNAMODB_TABLE_NAME ?? 'order_events';

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

async function provisionDsqlCluster(): Promise<string> {
  const dsql = new DSQLClient({ region });

  console.log('Creating Aurora DSQL cluster...');
  const created = await dsql.send(
    new CreateClusterCommand({
      // Enabled per submission guidance (protects the cluster from accidental
      // deletion). To delete later: disable protection, then delete the cluster.
      deletionProtectionEnabled: true,
      tags: { Name: 'axiom', project: 'axiom-hackathon' },
    }),
  );

  const identifier = created.identifier;
  if (!identifier) {
    throw new Error('CreateCluster did not return a cluster identifier.');
  }
  console.log(`  identifier: ${identifier}`);
  console.log(`  status: ${created.status ?? 'UNKNOWN'}`);

  let status = created.status;
  while (status !== 'ACTIVE') {
    await sleep(5000);
    const got = await dsql.send(new GetClusterCommand({ identifier }));
    status = got.status;
    console.log(`  status: ${status ?? 'UNKNOWN'}`);
    if (status === 'FAILED' || status === 'DELETING' || status === 'DELETED') {
      throw new Error(`Cluster entered unexpected status: ${status}`);
    }
  }

  const endpoint = `${identifier}.dsql.${region}.on.aws`;
  console.log(`  endpoint: ${endpoint}`);
  return endpoint;
}

async function provisionDynamoTable(): Promise<void> {
  const client = new DynamoDBClient({ region }); // real AWS — no local endpoint override

  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`DynamoDB table "${tableName}" already exists.`);
    return;
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }
  }

  console.log(`Creating DynamoDB table "${tableName}" (PAY_PER_REQUEST)...`);
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      AttributeDefinitions: [
        { AttributeName: 'symbol', AttributeType: 'S' },
        { AttributeName: 'event_sk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'symbol', KeyType: 'HASH' },
        { AttributeName: 'event_sk', KeyType: 'RANGE' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    }),
  );
  await waitUntilTableExists({ client, maxWaitTime: 120 }, { TableName: tableName });
  console.log(`DynamoDB table "${tableName}" is ACTIVE.`);
}

async function main(): Promise<void> {
  requireCredentials();
  console.log(`AWS region: ${region}\n`);

  const endpoint = await provisionDsqlCluster();
  await provisionDynamoTable();

  console.log('\n=== PROVISIONING COMPLETE ===');
  console.log('Add this line to your .env, then run `npm run db:migrate:dsql`:');
  console.log(`  DSQL_CLUSTER_ENDPOINT=${endpoint}`);
}

main().catch((err: unknown) => {
  console.error('\nProvisioning failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
