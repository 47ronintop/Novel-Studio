import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*", "../../*"],
              message: "Use package public entrypoints; do not create cross-layer relative imports."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["**/test/**/*.ts", "**/*.test.ts"],
    rules: {
      "no-restricted-imports": "off"
    }
  }
);
