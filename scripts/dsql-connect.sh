#!/usr/bin/env bash
#
# Generate a short-lived Aurora DSQL auth token and print the env exports that
# point AXIOM at the cluster. Aurora DSQL has no static password — the token IS
# the password and expires (here, in 1 hour). Re-run to refresh.
#
# Usage:
#   eval "$(ENDPOINT=<cluster-endpoint> REGION=us-east-1 bash scripts/dsql-connect.sh)"
#   npm run db:migrate
#
set -euo pipefail

ENDPOINT="${ENDPOINT:?Set ENDPOINT to your DSQL cluster endpoint (xxxx.dsql.<region>.on.aws)}"
REGION="${REGION:-${AWS_REGION:-us-east-1}}"

TOKEN=$(aws dsql generate-db-connect-admin-auth-token \
  --hostname "$ENDPOINT" \
  --region "$REGION" \
  --expires-in 3600)

# URL-encode the token so it is safe inside a connection string password field.
ENCODED=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$TOKEN")

echo "export DATABASE_URL='postgresql://admin:${ENCODED}@${ENDPOINT}:5432/postgres?sslmode=require'"
echo "export DATABASE_SSL=require"
echo "export DATABASE_TARGET=dsql"
echo "export DSQL_CLUSTER_ENDPOINT=${ENDPOINT}"
