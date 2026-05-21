#!/bin/bash
# usage: deploy.sh <local_file> <app_path> [restart]
FILE=$1; PATH_ARG=$2; RESTART=${3:-false}
TOKEN="d5f9e9b215da795ef927a399c3eba355"
curl -s -X POST "http://localhost:8000/api/deploy?path=${PATH_ARG}&restart=${RESTART}" -H "x-token: $TOKEN" -F "file=@${FILE}"
echo
