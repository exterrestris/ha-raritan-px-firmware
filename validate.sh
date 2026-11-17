#!/usr/bin/bash
docker compose build
docker compose run --rm bundle-schema
docker compose run --rm validate-json
