import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import type { Extension } from "@codemirror/state";

export type EditorLanguage =
  | "css"
  | "html"
  | "javascript"
  | "json"
  | "markdown"
  | "plain"
  | "python"
  | "sql"
  | "typescript"
  | "xml";

const LANGUAGE_LABELS: Record<EditorLanguage, string> = {
  css: "CSS",
  html: "HTML",
  javascript: "JavaScript",
  json: "JSON",
  markdown: "Markdown",
  plain: "Text",
  python: "Python",
  sql: "SQL",
  typescript: "TypeScript",
  xml: "XML"
};

export function editorLanguageFromPath(path: string): EditorLanguage {
  const extension = editorPathExtension(path)?.toLocaleLowerCase();

  switch (extension) {
    case "css":
      return "css";
    case "htm":
    case "html":
      return "html";
    case "cjs":
    case "js":
    case "jsx":
    case "mjs":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
    case "json":
    case "jsonc":
      return "json";
    case "md":
    case "markdown":
    case "mdx":
      return "markdown";
    case "py":
    case "pyw":
      return "python";
    case "sql":
      return "sql";
    case "svg":
    case "xml":
      return "xml";
    default:
      return "plain";
  }
}

export function editorLanguageLabel(language: EditorLanguage): string {
  return LANGUAGE_LABELS[language];
}

export function editorFileModeLabel(path: string): string {
  const language = editorLanguageFromPath(path);
  if (language !== "plain") {
    return editorLanguageLabel(language);
  }

  return editorPathExtension(path)?.toLocaleUpperCase() ?? "Text";
}

export function editorLanguageExtension(language: EditorLanguage): Extension {
  switch (language) {
    case "css":
      return css();
    case "html":
      return html();
    case "javascript":
      return javascript({ jsx: true, typescript: true });
    case "json":
      return json();
    case "markdown":
      return markdown();
    case "python":
      return python();
    case "sql":
      return sql();
    case "typescript":
      return javascript({ jsx: true, typescript: true });
    case "xml":
      return xml();
    case "plain":
      return [];
  }
}

function editorPathExtension(path: string): string | undefined {
  return path.replaceAll("\\", "/").split("/").at(-1)?.split(".").at(-1);
}
