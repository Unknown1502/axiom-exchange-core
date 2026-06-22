/**
 * DynamoDB DocumentClient factory.
 *
 * Works in two modes from the same code:
 *   * Local dev   — set DYNAMODB_ENDPOINT (e.g. http://localhost:8000) to talk
 *                   to a DynamoDB Local container. Dummy credentials are used.
 *   * Real AWS    — leave DYNAMODB_ENDPOINT unset; the default AWS credential
 *                   provider chain + AWS_REGION are used.
 *
 * The DocumentClient is created lazily and cached so we open one connection
 * pool per process.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { config as loadEnv } from 'dotenv';

let envLoaded = false;
function ensureEnv(): void {
  if (!envLoaded) {
    loadEnv();
    envLoaded = true;
  }
}

export interface DynamoSettings {
  region: string;
  tableName: string;
  /** When set, target a local DynamoDB endpoint instead of real AWS. */
  endpoint: string | undefined;
}

export function getDynamoSettings(): DynamoSettings {
  ensureEnv();
  return {
    region: process.env.AWS_REGION ?? 'us-east-1',
    tableName: process.env.DYNAMODB_TABLE_NAME ?? 'order_events',
    endpoint: process.env.DYNAMODB_ENDPOINT,
  };
}

let cachedBase: DynamoDBClient | undefined;
let cachedDoc: DynamoDBDocumentClient | undefined;

/** The low-level client (used for table administration in setup.ts). */
export function getBaseClient(): DynamoDBClient {
  if (cachedBase) {
    return cachedBase;
  }
  const settings = getDynamoSettings();
  cachedBase = new DynamoDBClient({
    region: settings.region,
    ...(settings.endpoint
      ? {
          endpoint: settings.endpoint,
          // DynamoDB Local ignores credentials but the SDK requires some.
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        }
      : {}),
  });
  return cachedBase;
}

/** The high-level DocumentClient (used for all reads/writes of events). */
export function getDocumentClient(): DynamoDBDocumentClient {
  if (cachedDoc) {
    return cachedDoc;
  }
  cachedDoc = DynamoDBDocumentClient.from(getBaseClient(), {
    // Optional event attributes (trade_id, trade_price) are sometimes absent;
    // strip undefined rather than throwing on marshalling.
    marshallOptions: { removeUndefinedValues: true },
  });
  return cachedDoc;
}

export function getTableName(): string {
  return getDynamoSettings().tableName;
}
