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

function createCatalogue() {
  return {
    firmwares: []
  };
}

function addFirmware(catalogue, firmware, products) {
  catalogue.firmwares.push(firmware);

  // Preserve each firmware's products array and collect
  // distinct products for the consolidated catalogue.
  for (const product of firmware.products ?? []) {
    products.add(product);
  }
}

function addRecord(catalogue, record, source, products) {
  // Allow arrays containing multiple records.
  if (Array.isArray(record)) {
    for (const item of record) {
      addRecord(catalogue, item, source, products);
    }
    return;
  }

  // Ignore standalone product records.
  if (typeof record === "string") {
    return;
  }

  if (
    record === null ||
    typeof record !== "object"
  ) {
    throw new Error(
      `Unsupported JSON value in ${source}`
    );
  }

  // Identify firmware records before catalogue fragments.
  if (
    "firmware_url" in record ||
    "version" in record
  ) {
    addFirmware(catalogue, record, products);
    return;
  }

  // Advisory records.
  if (
    "issue" in record ||
    "affects" in record ||
    "fixed_in" in record
  ) {
    (catalogue.advisories ??= []).push(record);
    return;
  }

  // Allow existing catalogue fragments to be merged.
  if (
    "versions" in record ||
    "firmwares" in record ||
    "advisories" in record ||
    "products" in record
  ) {
    // Deliberately ignore record.products.
    // Catalogue products are derived from firmware records only.

    if (record.versions !== undefined) {
      addRecord(catalogue, record.versions, source, products);
    }

    // Accept the previous "firmwares" input spelling.
    if (record.firmwares !== undefined) {
      addRecord(catalogue, record.firmwares, source, products);
    }

    if (record.advisories !== undefined) {
      catalogue.advisories ??= [];
      addRecord(catalogue, record.advisories, source, products);
    }

    return;
  }

  throw new Error(
    `Cannot determine record type in ${source}`
  );
}

function createValidator(schema) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    verbose: true
  });

  addFormats(ajv);

  return ajv.compile(schema);
}

function reportValidationErrors(errors) {
  for (const error of errors || []) {
    console.error(
      `  ${error.instancePath || "/"}: ${error.message}`
    );
  }
}

async function consolidate(
  inputDirectory,
  schemaFile,
  outputFile,
  recursive = false
) {
  const directory = path.resolve(inputDirectory);
  const schemaPath = path.resolve(schemaFile);
  const outputPath = path.resolve(outputFile);

  try {
    // Load the bundled catalogue schema.
    const schema = JSON.parse(
      await fs.readFile(schemaPath, "utf8")
    );

    const validate = createValidator(schema);

    // Discover input files.
    const files = await findJsonFiles(
      directory,
      recursive
    );

    // Do not accidentally include the previous output.
    const inputFiles = files.filter(
      file => path.resolve(file) !== outputPath
    );

    if (inputFiles.length === 0) {
      throw new Error("No input JSON files found.");
    }

    console.log(
      `Found ${inputFiles.length} JSON file(s).\n`
    );

    const catalogue = createCatalogue();
    const products = new Set();

    let readCount = 0;
    let failedCount = 0;

    // Read and classify all input records.
    for (const file of inputFiles) {
      const relativePath = path.relative(directory, file);

      try {
        const content = await fs.readFile(file, "utf8");
        const json = JSON.parse(content);

        addRecord(catalogue, json, relativePath, products);

        console.log(`✓ Loaded ${relativePath}`);
        readCount++;
      } catch (error) {
        console.error(`✗ ${relativePath}`);
        console.error(`  ${error.message}`);
        failedCount++;
      }
    }

    if (failedCount > 0) {
      throw new Error(
        `${failedCount} input file(s) could not be processed.`
      );
    }

    // Populate catalogue products from the distinct products
    // referenced by all consolidated firmware versions.
    if (products.size > 0) {
      catalogue.products = [...products].sort();
    }

    // Validate the complete consolidated catalogue.
    console.log("\nValidating consolidated catalogue...");

    if (!validate(catalogue)) {
      console.error("Catalogue validation failed:");

      reportValidationErrors(validate.errors);

      throw new Error(
        "Consolidated catalogue does not match the schema."
      );
    }

    // Only write the output after successful validation.
    await fs.mkdir(path.dirname(outputPath), {
      recursive: true
    });

    await fs.writeFile(
      outputPath,
      JSON.stringify(catalogue, null, 2) + "\n",
      "utf8"
    );

    console.log("\nConsolidation successful.");
    console.log("-------------------------");
    console.log(`Files processed: ${readCount}`);
    console.log(`Products:        ${(catalogue.products ?? []).length}`);
    console.log(`Firmwares:       ${catalogue.firmwares.length}`);
    console.log(`Advisories:      ${(catalogue.advisories ?? []).length}`);
    console.log(`Output:          ${outputPath}`);

  } catch (error) {
    console.error("\nConsolidation failed:");
    console.error(error);
    process.exitCode = 1;
  }
}

// CLI entry point.
const args = process.argv.slice(2);

const recursive = args.includes("--recursive");

const positionalArgs = args.filter(
  arg => arg !== "--recursive"
);

if (
  positionalArgs.length < 1 ||
  positionalArgs.length > 3
) {
  console.error(
    "Usage: node consolidate-json.mjs " +
    "<input-directory> [schema.json] [output.json] [--recursive]"
  );

  process.exit(1);
}

const inputDirectory = positionalArgs[0];
const schemaFile = positionalArgs[1] || "dist/schema.json";
const outputFile = positionalArgs[2] || "dist/catalogue.json";

await consolidate(
  inputDirectory,
  schemaFile,
  outputFile,
  recursive
);
