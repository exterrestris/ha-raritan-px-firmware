#!/usr/bin/env node

import $RefParser from "@apidevtools/json-schema-ref-parser";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";


function normalizeSchemaUris(schema) {
  const visited = new WeakSet();

  function walk(value) {
    if (value === null || typeof value !== "object") {
      return;
    }

    if (visited.has(value)) {
      return;
    }

    visited.add(value);

    if (value.$schema === "http://json-schema.org/draft/2020-12/schema") {
      value.$schema = "https://json-schema.org/draft/2020-12/schema";
    }

    for (const child of Object.values(value)) {
      walk(child);
    }
  }

  walk(schema);
}

function removeNestedIds(schema) {
  function walk(value, isRoot = false) {
    if (!value || typeof value !== "object") {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(item => walk(item));
      return;
    }

    // Preserve the root schema ID, remove embedded schema IDs.
    if (!isRoot) {
      delete value.$id;
    }

    for (const child of Object.values(value)) {
      walk(child);
    }
  }

  walk(schema, true);
}

async function bundleSchema(inputFile, outputFile) {
  const inputPath = path.resolve(inputFile);
  const outputPath = path.resolve(outputFile);

  try {
    console.log(`Reading schema: ${inputPath}`);

    // Bundle all external references into the root schema.
    // External $refs are converted into internal JSON pointers.
    const bundledSchema = await $RefParser.bundle(inputPath);

    // Normalize JSON Schema meta-schema URIs.
    normalizeSchemaUris(bundledSchema);

    // Remove nested IDs that create independent
    // JSON Schema resource boundaries.
    removeNestedIds(bundledSchema);

    // Write the bundled schema to disk.
    await fs.mkdir(path.dirname(outputPath), {
      recursive: true
    });

    await fs.writeFile(
      outputPath,
      JSON.stringify(bundledSchema, null, 2) + "\n",
      "utf8"
    );

    console.log(`Successfully bundled schema: ${outputPath}`);
  } catch (error) {
    console.error("Failed to bundle schema:");
    console.error(error.message);
    process.exitCode = 1;
  }
}

// CLI entry point
const args = process.argv.slice(2);

if (args.length < 1 || args.length > 2) {
  console.error(
    "Usage: node bundle-schema.mjs <input-schema.json> [output-schema.json]"
  );
  process.exit(1);
}

const inputFile = args[0];
const outputFile = args[1] || "bundled-schema.json";

await bundleSchema(inputFile, outputFile);
