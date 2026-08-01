import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  STORY_BIBLE_V11_ASSET_TYPES,
  createStoryAnalysisBundleSchema,
  createStoryBibleV11Schema,
  storyBibleSchemaFileName
} from "../packages/schemas/dist/index.js";

const schemaDirectory = join(process.cwd(), "packages", "schemas", "schema");

for (const assetType of STORY_BIBLE_V11_ASSET_TYPES) {
  const schema = createStoryBibleV11Schema(assetType, "writeStrict");
  const target = join(schemaDirectory, `${storyBibleSchemaFileName(assetType)}.schema.json`);
  await writeFile(target, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
}

const workflowRunSchemaPath = join(schemaDirectory, "workflow-run-record.schema.json");
const workflowRunSchema = JSON.parse(await readFile(workflowRunSchemaPath, "utf8"));
workflowRunSchema.properties.storyAnalysis = createStoryAnalysisBundleSchema();
await writeFile(workflowRunSchemaPath, `${JSON.stringify(workflowRunSchema, null, 2)}\n`, "utf8");
