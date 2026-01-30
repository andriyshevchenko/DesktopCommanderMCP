import { z } from "zod";

// Python package name validation regex
// Validates pip package names with version specifiers and extras
// Allowed characters: letters, digits, hyphens, underscores, dots, brackets for extras,
// comparison operators (>, <, =, !), and commas for multiple version constraints
// Must not start with '-' to prevent argument injection, and disallows '..' or '--'
export const PACKAGE_NAME_REGEX = /^(?!-)(?!.*(\.\.|--))[A-Za-z0-9_.\-\[\]!\>=<,]+$/;

// Config tools schemas
export const GetConfigArgsSchema = z.object({});

export const SetConfigValueArgsSchema = z.object({
  key: z.string(),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.null(),
  ]),
});

// Empty schemas
export const ListProcessesArgsSchema = z.object({});

// Terminal tools schemas
export const StartProcessArgsSchema = z.object({
  command: z.string(),
  timeout_ms: z.number(),
  shell: z.string().optional(),
  verbose_timing: z.boolean().optional(),
});

export const ReadProcessOutputArgsSchema = z.object({
  pid: z.number(),
  timeout_ms: z.number().optional(),
  offset: z.number().optional(),   // Line offset: 0=from last read, positive=absolute, negative=tail
  length: z.number().optional(),   // Max lines to return (default from config.fileReadLineLimit)
  verbose_timing: z.boolean().optional(),
});

export const ForceTerminateArgsSchema = z.object({
  pid: z.number(),
});

export const ListSessionsArgsSchema = z.object({});

export const KillProcessArgsSchema = z.object({
  pid: z.number(),
});

// Filesystem tools schemas
export const ReadFileArgsSchema = z.object({
  path: z.string(),
  isUrl: z.boolean().optional().default(false),
  offset: z.number().optional().default(0),
  length: z.number().optional().default(1000),
  sheet: z.string().optional(),  // String only for MCP client compatibility (Cursor doesn't support union types in JSON Schema)
  range: z.string().optional(),
  options: z.record(z.any()).optional()
});

export const ReadMultipleFilesArgsSchema = z.object({
  paths: z.array(z.string()),
});

export const WriteFileArgsSchema = z.object({
  path: z.string(),
  content: z.string(),
  mode: z.enum(['rewrite', 'append']).default('rewrite'),
});

// PDF modification schemas - exported for reuse
export const PdfInsertOperationSchema = z.object({
  type: z.literal('insert'),
  pageIndex: z.number(),
  markdown: z.string().optional(),
  sourcePdfPath: z.string().optional(),
  pdfOptions: z.object({}).passthrough().optional(),
});

export const PdfDeleteOperationSchema = z.object({
  type: z.literal('delete'),
  pageIndexes: z.array(z.number()),
});

export const PdfOperationSchema = z.union([PdfInsertOperationSchema, PdfDeleteOperationSchema]);

export const WritePdfArgsSchema = z.object({
  path: z.string(),
  // Preprocess content to handle JSON strings that should be parsed as arrays
  content: z.preprocess(
    (val) => {
      // If it's a string that looks like JSON array, parse it
      if (typeof val === 'string' && val.trim().startsWith('[')) {
        try {
          return JSON.parse(val);
        } catch {
          // If parsing fails, return as-is (might be markdown content)
          return val;
        }
      }
      // Otherwise return as-is
      return val;
    },
    z.union([z.string(), z.array(PdfOperationSchema)])
  ),
  outputPath: z.string().optional(),
  options: z.object({}).passthrough().optional(), // Allow passing options to md-to-pdf
});

export const CreateDirectoryArgsSchema = z.object({
  path: z.string(),
});

export const ListDirectoryArgsSchema = z.object({
  path: z.string(),
  depth: z.number().optional().default(2),
});

export const MoveFileArgsSchema = z.object({
  source: z.string(),
  destination: z.string(),
});

export const GetFileInfoArgsSchema = z.object({
  path: z.string(),
});

// Edit tools schema - SIMPLIFIED from three modes to two
// Previously supported: text replacement, location-based edits (edits array), and range rewrites
// Now supports only: text replacement and range rewrites
// Removed 'edits' array parameter - location-based surgical edits were complex and unnecessary
// Range rewrites are more powerful and cover all structured file editing needs
export const EditBlockArgsSchema = z.object({
  file_path: z.string(),
  // Text file string replacement
  old_string: z.string().optional(),
  new_string: z.string().optional(),
  expected_replacements: z.number().optional().default(1),
  // Structured file range rewrite (Excel, etc.)
  range: z.string().optional(),
  content: z.any().optional(),
  options: z.record(z.any()).optional()
}).refine(
  data => {
    // Helper to check if value is actually provided (not undefined, not empty string)
    const hasValue = (v: unknown) => v !== undefined && v !== '';
    return (hasValue(data.old_string) && hasValue(data.new_string)) ||
           (hasValue(data.range) && hasValue(data.content));
  },
  { message: "Must provide either (old_string + new_string) or (range + content)" }
);

// Send input to process schema
export const InteractWithProcessArgsSchema = z.object({
  pid: z.number(),
  input: z.string(),
  timeout_ms: z.number().optional(),
  wait_for_prompt: z.boolean().optional(),
  verbose_timing: z.boolean().optional(),
});

// Usage stats schema
export const GetUsageStatsArgsSchema = z.object({});

// Feedback tool schema - no pre-filled parameters, all user input
export const GiveFeedbackArgsSchema = z.object({
  // No parameters needed - form will be filled manually by user
  // Only auto-filled hidden fields remain:
  // - tool_call_count (auto)
  // - days_using (auto) 
  // - platform (auto)
  // - client_id (auto)
});

// Search schemas (renamed for natural language)
export const StartSearchArgsSchema = z.object({
  path: z.string(),
  pattern: z.string(),
  searchType: z.enum(['files', 'content']).default('files'),
  filePattern: z.string().optional(),
  ignoreCase: z.boolean().optional().default(true),
  maxResults: z.number().optional(),
  includeHidden: z.boolean().optional().default(false),
  contextLines: z.number().optional().default(5),
  timeout_ms: z.number().optional(), // Match process naming convention
  earlyTermination: z.boolean().optional(), // Stop search early when exact filename match is found (default: true for files, false for content)
  literalSearch: z.boolean().optional().default(false), // Force literal string matching (-F flag) instead of regex
});

export const GetMoreSearchResultsArgsSchema = z.object({
  sessionId: z.string(),
  offset: z.number().optional().default(0),    // Same as file reading
  length: z.number().optional().default(100),  // Same as file reading (but smaller default)
});

export const StopSearchArgsSchema = z.object({
  sessionId: z.string(),
});

export const ListSearchesArgsSchema = z.object({});

// Prompts tool schema - SIMPLIFIED (only get_prompt action)
export const GetPromptsArgsSchema = z.object({
  action: z.enum(['get_prompt']),
  promptId: z.string(),
  // Disabled to check if it makes sense or should be removed or changed
  // anonymous_user_use_case: z.string().optional(),
});

// Tool history schema
export const GetRecentToolCallsArgsSchema = z.object({
  maxResults: z.number().min(1).max(1000).optional().default(50),
  toolName: z.string().optional(),
  since: z.string().datetime().optional(),
});

// Python code execution schema
// Improvements:
// - Auto timeout: Set timeout_ms to "auto" to automatically use 120s when installing packages, 30s otherwise
// - Persistent workspace: Use workspace="persistent" to maintain files across executions in ~/.desktop-commander/python-workspace
// - Custom workspace: Provide a custom path to workspace parameter for a specific directory
// - Detailed format: Set return_format="detailed" to include workspace path and execution stats
// - UTF-8 encoding: Automatically enforced on Windows to prevent charmap codec errors
export const ExecutePythonCodeArgsSchema = z.object({
  code: z.string().trim().min(1, { message: "code must not be empty" }),
  target_directory: z.string().optional(),
  timeout_ms: z.union([
    z.number().int().min(1000).max(300000),
    z.literal("auto")  // Auto-detect: 120s with packages, 30s without
  ]).optional().default("auto"),
  install_packages: z
    .array(
      z
        .string()
        .trim()
        .min(1, { message: "package name must not be empty" })
        .regex(PACKAGE_NAME_REGEX, {
          message:
            "invalid package name: must not start with '-' and may only contain letters, digits, '_', '.', '-', and version specifiers ([, ], =, <, >, ,, !)",
        }),
    )
    .optional(),
  workspace: z.union([
    z.literal("persistent"),  // Use ~/.desktop-commander/python-workspace (persists across executions)
    z.literal("temp"),        // Use temporary directory (default, cleaned up after execution)
    z.string()                // Custom absolute or relative path
  ]).optional().default("temp"),
  return_format: z.union([
    z.literal("simple"),      // Just stdout/stderr (default)
    z.literal("detailed")     // Includes workspace path, timeout, installed packages
  ]).optional().default("simple"),
});

