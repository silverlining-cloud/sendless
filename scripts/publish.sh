#!/usr/bin/env bash
# Uploads dist/release to S3 and prints the one-click launch link.
#
#   scripts/publish.sh my-public-bucket [sendless]
#
# Files go to <bucket>/<prefix>/v<version>/. The bucket must allow public s3:GetObject (bucket policy),
# because CloudFormation and the bootstrap function fetch the files anonymously over HTTPS.
# Build first with: npm run release -- --base-url https://<bucket>.s3.<bucket-region>.amazonaws.com[/<prefix>]
set -euo pipefail

bucket="${1:?usage: publish.sh <bucket> [<prefix>]}"
prefix="${2:-}"
prefix="${prefix%/}"
version="$(node -p "require('./package.json').version")"

for f in backend.zip web.zip sendless.yaml SHA256SUMS; do
  test -f "dist/release/$f" || { echo "dist/release/$f is missing — run npm run release first" >&2; exit 1; }
done

region="$(aws s3api get-bucket-location --bucket "$bucket" --query LocationConstraint --output text)"
[ "$region" = "None" ] && region="us-east-1"
base="https://${bucket}.s3.${region}.amazonaws.com${prefix:+/$prefix}"
if ! grep -q "Default: ${base}\$" dist/release/sendless.yaml; then
  echo "Warning: the template's ArtifactBaseUrl is not ${base}" >&2
  echo "         rebuild with: npm run release -- --base-url ${base}" >&2
fi

dest="s3://${bucket}/${prefix:+$prefix/}v${version}"
aws s3 cp dist/release/backend.zip "${dest}/backend.zip" --content-type application/zip
aws s3 cp dist/release/web.zip "${dest}/web.zip" --content-type application/zip
aws s3 cp dist/release/SHA256SUMS "${dest}/SHA256SUMS" --content-type text/plain
aws s3 cp dist/release/sendless.yaml "${dest}/sendless.yaml" --content-type application/x-yaml

template_url="${base}/v${version}/sendless.yaml"
echo
echo "Template: ${template_url}"
echo "Launch:   https://console.aws.amazon.com/cloudformation/home#/stacks/quickcreate?templateURL=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "${template_url}")&stackName=sendless"
