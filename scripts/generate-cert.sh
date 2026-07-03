#!/usr/bin/env bash
#
# generate-cert.sh
#
# Generates a self-signed TLS certificate + private key for running the
# chat server over HTTPS on localhost during development/testing.
#
# NOTE: Browsers will show a security warning for self-signed certificates
# (this is expected — you'll need to click "Advanced" -> "Proceed" the
# first time you visit). For a publicly trusted certificate with no
# warnings, use Let's Encrypt via a reverse proxy instead — see the
# "HTTPS in Production" section of README.md.
#
# Usage:
#   npm run generate-cert
#
# Output:
#   certs/key.pem
#   certs/cert.pem

set -e

CERT_DIR="$(dirname "$0")/../certs"
mkdir -p "$CERT_DIR"

if ! command -v openssl &> /dev/null; then
  echo "❌ openssl is not installed. Please install it and try again."
  exit 1
fi

openssl req -x509 -newkey rsa:2048 \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -days 365 \
  -nodes \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo ""
echo "✅ Self-signed certificate generated:"
echo "   $CERT_DIR/key.pem"
echo "   $CERT_DIR/cert.pem"
echo ""
echo "Run 'npm start' and open https://localhost:3000"
echo "(your browser will warn about the self-signed cert — that's expected in dev)"
