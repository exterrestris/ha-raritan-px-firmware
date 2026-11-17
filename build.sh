#!/usr/bin/bash
docker compose build
docker compose run --rm schema-bundler
docker compose run --rm json-validator
docker compose run --rm json-consolidator
