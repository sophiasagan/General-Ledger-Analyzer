#!/bin/sh
# Substitute ${API_INTERNAL_URL} from the environment into nginx.conf,
# then start nginx. Railway sets API_INTERNAL_URL on the frontend service.
set -e

TEMPLATE="/app/nginx.conf"
DEST="/etc/nginx/conf.d/default.conf"

if [ -z "$API_INTERNAL_URL" ]; then
  echo "ERROR: API_INTERNAL_URL is not set. Set it in Railway to the internal URL of the api service." >&2
  exit 1
fi

envsubst '${API_INTERNAL_URL}' < "$TEMPLATE" > "$DEST"
echo "nginx.conf written — proxying API calls to $API_INTERNAL_URL"

exec nginx -g "daemon off;"
