#!/usr/bin/env bash
#
# Provision an Aurora DSQL cluster and print the connection steps.
# Requires the AWS CLI (v2, recent) configured with credentials.
# Run: bash scripts/provision-dsql.sh
#
# NOTE: Aurora DSQL CLI flags can vary slightly by CLI version. If a flag is
# rejected, check `aws dsql create-cluster help` and adjust. The endpoint format
# and the auth-token command below are stable and documented by AWS.
#
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"

echo "Creating Aurora DSQL cluster in $REGION..."
IDENTIFIER=$(aws dsql create-cluster \
  --no-deletion-protection-enabled \
  --region "$REGION" \
  --query 'identifier' --output text)

echo "Cluster identifier: $IDENTIFIER"
echo "Waiting for ACTIVE status (this can take a couple of minutes)..."
while true; do
  STATUS=$(aws dsql get-cluster --identifier "$IDENTIFIER" --region "$REGION" \
    --query 'status' --output text 2>/dev/null || echo "PENDING")
  echo "  status: $STATUS"
  [ "$STATUS" = "ACTIVE" ] && break
  sleep 5
done

ENDPOINT="${IDENTIFIER}.dsql.${REGION}.on.aws"
echo ""
echo "Cluster ACTIVE."
echo "  Identifier: $IDENTIFIER"
echo "  Endpoint:   $ENDPOINT"
echo ""
echo "Next steps:"
echo "  1. Generate connection env (token valid ~1h):"
echo "       eval \"\$(ENDPOINT=$ENDPOINT REGION=$REGION bash scripts/dsql-connect.sh)\""
echo "  2. Apply the schema:"
echo "       npm run db:migrate"
echo "  3. Start the API against DSQL:"
echo "       npm run api:start"
