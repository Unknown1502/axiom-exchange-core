/**
 * @axiom/dynamodb-client — the order-event firehose (audit log) on DynamoDB.
 */

export {
  getDynamoSettings,
  getDocumentClient,
  getBaseClient,
  getTableName,
  type DynamoSettings,
} from './client.js';
export {
  writeOrderEvent,
  writeTradeEvent,
  writeRejectedDuplicateEvent,
  getRecentEvents,
  countEvents,
  type OrderEvent,
  type FirehoseEventType,
  type SubmittedEventInput,
  type MatchedEventInput,
  type RejectedDuplicateEventInput,
} from './events.js';
export { ensureOrderEventsTable } from './setup.js';
