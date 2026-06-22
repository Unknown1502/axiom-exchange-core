#!/usr/bin/env bash
#
# Provision the `order_events` DynamoDB table (the firehose / audit log).
# Requires the AWS CLI configured with credentials. Run: bash scripts/provision-dynamodb.sh
#
set -euo pipefail

TABLE="${DYNAMODB_TABLE_NAME:-order_events}"
REGION="${AWS_REGION:-us-east-1}"

echo "Creating DynamoDB table '$TABLE' in $REGION (PAY_PER_REQUEST)..."
aws dynamodb create-table \
  --table-name "$TABLE" \
  --attribute-definitions \
    AttributeName=symbol,AttributeType=S \
    AttributeName=event_sk,AttributeType=S \
  --key-schema \
    AttributeName=symbol,KeyType=HASH \
    AttributeName=event_sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --region "$REGION"

echo "Waiting for table to become ACTIVE..."
aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"

echo "Done. '$TABLE' is ACTIVE in $REGION."
echo "Set these in your deployment environment (and UNSET DYNAMODB_ENDPOINT):"
echo "  AWS_REGION=$REGION"
echo "  DYNAMODB_TABLE_NAME=$TABLE"
