import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "coverage/**",
      "next-env.d.ts",
      "worker-configuration.d.ts",
      ".wrangler/**",
      ".open-next/**",
      "scripts/**",
      ".claude/**",
      // Linked git worktrees used by the ClaudeOS agent team live inside the
      // repo. They are checkouts of this same repo, so linting them duplicates
      // every finding and lets an in-flight edit break the main tree's lint.
      ".worktrees/**",
      "_worktrees/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
