/**
 * Print authentic, verifiable details of the LIVE AWS resources (Aurora DSQL
 * cluster + DynamoDB table) directly from the AWS control plane. Screenshot the
 * output as "AWS Database proof" evidence for the submission.
 *
 * Usage: `npm run aws:proof`
 */

import { config as loadEnv } from 'dotenv';
import { DSQLClient, GetClusterCommand } from '@aws-sdk/client-dsql';
import { DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';

loadEnv();

const region = process.env.AWS_REGION ?? 'us-east-1';
const endpoint = process.env.DSQL_CLUSTER_ENDPOINT ?? '';
const identifier = endpoint.split('.')[0] ?? '';
const tableName = process.env.DYNAMODB_TABLE_NAME ?? 'order_events';

async function main(): Promise<void> {
  if (!identifier) {
    throw new Error('DSQL_CLUSTER_ENDPOINT not set in .env');
  }

  const dsql = new DSQLClient({ region });
  const cluster = await dsql.send(new GetClusterCommand({ identifier }));

  console.log('======================================================');
  console.log(' AXIOM — LIVE AWS RESOURCE PROOF');
  console.log(`  generated ${new Date().toISOString()}`);
  console.log('======================================================');
  console.log('\n[ AMAZON AURORA DSQL — primary source of truth ]');
  console.log(`  Identifier ........ ${cluster.identifier}`);
  console.log(`  ARN ............... ${cluster.arn}`);
  console.log(`  Status ............ ${cluster.status}`);
  console.log(`  Endpoint .......... ${endpoint}`);
  console.log(`  Region ............ ${region}`);
  console.log(`  Created ........... ${cluster.creationTime?.toISOString?.() ?? cluster.creationTime}`);
  console.log(`  Deletion protect .. ${cluster.deletionProtectionEnabled}`);

  const ddb = new DynamoDBClient({ region });
  const table = await ddb.send(new DescribeTableCommand({ TableName: tableName }));
  const t = table.Table;

  console.log('\n[ AMAZON DYNAMODB — order-event firehose ]');
  console.log(`  Table ............. ${t?.TableName}`);
  console.log(`  ARN ............... ${t?.TableArn}`);
  console.log(`  Status ............ ${t?.TableStatus}`);
  console.log(`  Item count ........ ${t?.ItemCount}`);
  console.log(`  Billing ........... ${t?.BillingModeSummary?.BillingMode ?? 'PAY_PER_REQUEST'}`);
  console.log(`  Key schema ........ ${JSON.stringify(t?.KeySchema)}`);
  console.log('\n======================================================');
}

main().catch((err: unknown) => {
  console.error('aws:proof failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
