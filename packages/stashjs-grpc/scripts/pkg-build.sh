#!/usr/bin/env bash

# This script builds everything in the platform repo. It is written using the
# bash script best practices (see: https://kvz.io/bash-best-practices.html)

set -e # exit when a command fails
set -u # exit when script tries to use undeclared variables
if [[ -n "${DEBUG_PKG_BUILD_SH:-}" ]]; then
  set -x # trace what gets executed (useful for debugging)
fi

trap "echo SOMETHING WENT WRONG - please read the logs above and see if it helps you figure out what is wrong - and also ask an engineer help" ERR

rm -fr ./dist ./generated
mkdir -p ./dist ./generated/stash/GRPC

proto-loader-gen-types api.proto --outDir=generated --grpcLib=@grpc/grpc-js \
  --includeDirs grpc/v1 --keepCase=true --longs=number --enums=string \
  --defaults=false --oneofs==true

./scripts/pack-api.sh
npx -p typescript tsc
cp -RL grpc dist/generated/stash/GRPC
