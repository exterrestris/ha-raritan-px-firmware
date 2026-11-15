#!/usr/bin/env node

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

async function findJsonFiles(directory, recursive = false) {
  const files = [];
  const entries = await fs.readdir(directory, {
    withFileTypes: true
  });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory() && recursive) {
      files.push(
        ...await findJsonFiles(fullPath, recursive)
      );
    } else if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith(".json")
    ) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function formatErrors(errors) {
  return errors.map(error => {
    const location = error.instancePath || "/";
    return `  ${location}: ${error.message}`;
  });
}

async function validateDirectory(
  inputDirectory,
  schemaFile,
  recursive = false
) {
  const directory = path.resolve(inputDirectory);
  const schemaPath = path.resolve(schemaFile);

  try {
    // Load schema
    const schema = JSON.parse(
      await fs.readFile(schemaPath, "utf8")
    );

    // Configure Ajv for JSON Schema 2020-12
    const ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      verbose: true
    });

    addFormats(ajv);

    // Compile schema once and reuse it
    const validate = ajv.compile(schema);

    // Find input JSON files
    const files = await findJsonFiles(
      directory,
      recursive
    );

    if (files.length === 0) {
      console.log("No JSON files found.");
      return;
    }

    console.log(`Found ${files.length} JSON file(s).\n`);

    let validCount = 0;
    let invalidCount = 0;

    for (const file of files) {
      const relativePath = path.relative(directory, file);

      try {
        const content = await fs.readFile(file, "utf8");
        const json = JSON.parse(content);

        if (validate(json)) {
          console.log(`✓ ${relativePath}`);
          validCount++;
        } else {
          console.error(`✗ ${relativePath}`);

          for (const error of formatErrors(validate.errors)) {
            console.error(error);
          }

          invalidCount++;
        }
      } catch (error) {
        console.error(`✗ ${relativePath}`);
        console.error(`  ${error.message}`);
        invalidCount++;
      }
    }

    console.log("\nValidation summary");
    console.log("------------------");
    console.log(`Total:   ${files.length}`);
    console.log(`Valid:   ${validCount}`);
    console.log(`Invalid: ${invalidCount}`);

    if (invalidCount > 0) {
      process.exitCode = 1;
    }

  } catch (error) {
    console.error("Validation failed:");
    console.error(error);
    process.exitCode = 1;
  }
}

// CLI entry point
const args = process.argv.slice(2);
const recursive = args.includes("--recursive");
const positionalArgs = args.filter(
  arg => arg !== "--recursive"
);

if (positionalArgs.length < 1 || positionalArgs.length > 2) {
  console.error(
    "Usage: node validate-json.mjs <directory> [schema.json] [--recursive]"
  );
  process.exit(1);
}

const inputDirectory = positionalArgs[0];
const schemaFile = positionalArgs[1] || "dist/schema.json";

await validateDirectory(
  inputDirectory,
  schemaFile,
  recursive
);
