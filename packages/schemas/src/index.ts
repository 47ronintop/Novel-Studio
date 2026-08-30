import { Ajv, type AnySchema, type ErrorObject, type ValidateFunction } from "ajv/dist/ajv.js";
import addFormatsImport, { type FormatsPlugin } from "ajv-formats";

export {
  STORY_BIBLE_V11_ASSET_TYPES,
  collectStoryBibleDeclaredChapterReferences,
  collectStoryBibleDeclaredReferences,
  createStoryBibleCreateValueSchema,
  createStoryBibleDefaultDetails,
  createStoryBibleWriteCandidateSchema,
  createStoryBibleV11Schema,
  describeStoryBibleType,
  getStoryBibleKnownDetailKeys,
  isStoryBibleV11AssetType,
  inspectStoryBibleChapterReferences,
  inspectStoryBibleReferences,
  storyBibleChapterReferenceFingerprint,
  storyBibleReferenceFingerprint,
  storyBibleSchemaFileName,
  validateStoryBibleCreateValue,
  validateStoryBibleV11Asset,
  validateStoryBibleWriteCandidate
} from "./story-bible.js";
export type {
  StoryBibleDeclaredChapterReference,
  StoryBibleDeclaredReference,
  StoryBibleInspectedChapterReference,
  StoryBibleInspectedReference,
  StoryBibleReferenceTargetType,
  StoryBibleSchemaMode,
  StoryBibleSemanticValidationOptions,
  StoryBibleV11AssetType
} from "./story-bible.js";
export { evaluateStoryBibleCompleteness } from "./story-bible-completeness.js";
export type {
  StoryBibleCompletenessCheck,
  StoryBibleCompletenessCheckStatus,
  StoryBibleCompletenessCounts,
  StoryBibleCompletenessImportance,
  StoryBibleCompletenessInput,
  StoryBibleCompletenessReport,
  StoryBibleCompletenessStatus
} from "./story-bible-completeness.js";
export {
  STORY_EPISTEMIC_STATUSES,
  STORY_FACT_KINDS,
  STORY_OBSERVATION_DOMAINS,
  createStoryAnalysisBundleSchema,
  validateStoryAnalysisBundle
} from "./story-analysis.js";
export type {
  StoryAnalysisBundle,
  StoryAnalysisChapterBinding,
  StoryAnalysisDependency,
  StoryAnalysisPatchOperation,
  StoryAnalysisRun,
  StoryChangeSuggestion,
  StoryEpistemicStatus,
  StoryEvidenceRange,
  StoryFactDelta,
  StoryFactKind,
  StoryObservation,
  StoryObservationDomain,
  StoryReviewIssue
} from "./story-analysis.js";

const addFormats = addFormatsImport as unknown as FormatsPlugin;

export interface ValidationIssue {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export type SchemaValidator = (data: unknown) => ValidationResult;

export function createSchemaValidator(schema: unknown): SchemaValidator {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    removeAdditional: false
  });
  addFormats(ajv);

  const validate = ajv.compile(schema as AnySchema);

  return (data: unknown): ValidationResult => {
    const validationResult = validate(data);
    if (typeof validationResult !== "boolean") {
      throw new Error("Async JSON Schema validation is not supported for project contracts");
    }

    return {
      valid: validationResult,
      issues: validationResult ? [] : mapIssues(validate)
    };
  };
}

function mapIssues(validate: ValidateFunction): ValidationIssue[] {
  return (validate.errors ?? []).map((error: ErrorObject): ValidationIssue => {
    return {
      instancePath: error.instancePath,
      schemaPath: error.schemaPath,
      keyword: error.keyword,
      message: error.message ?? "Schema validation failed"
    };
  });
}
