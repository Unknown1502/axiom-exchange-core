/**
 * Table administration for `order_events`.
 *
 * Used locally to create the table in DynamoDB Local before the demo, and
 * usable against real AWS as an idempotent "create if absent". The production
 * provisioning path is scripts/provision-dynamodb.sh; this exists so local dev
 * has a real table without manual steps.
 *
 * Run directly: `npm run dynamo:setup`
 */

import {
  CreateTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import { fileURLToPath } from 'node:url';
import { getBaseClient, getTableName } from './client.js';

/** Create the order_events table if it does not already exist. */
export async function ensureOrderEventsTable(): Promise<'exists' | 'created'> {
  const client = getBaseClient();
  const tableName = getTableName();

  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    return 'exists';
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }
  }

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

  await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName: tableName });
  return 'created';
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  ensureOrderEventsTable()
    .then((result) => {
      console.log(`order_events table: ${result}`);
    })
    .catch((error: unknown) => {
      console.error('Failed to ensure order_events table:', error);
      process.exitCode = 1;
    });
}
