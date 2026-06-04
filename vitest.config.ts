import { defineConfig } from "vitest/config";
import path from "node:path";

// Minimal vitest config for pure-function unit tests in src/lib.
//
// We test the deadline resolver and the page-visibility catalog,
// neither of which need a real DB. The `server-only` alias points at
// an empty stub so the resolver's `import "server-only"` line doesn't
// throw outside a Next runtime. `@/` mirrors the runtime path alias
// defined in tsconfig.json.
export default defineConfig({
  resolve: {
    alias: [
      // Exact-match regex so `@/db` resolves to the stub but
      // `@/db/schema` still flows through the generic `@` -> ./src
      // alias below. The trailing `$` in the regex is what saves us.
      {
        find: /^@\/db$/,
        replacement: path.resolve(__dirname, "./test/db-stub.ts"),
      },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      {
        find: "server-only",
        replacement: path.resolve(__dirname, "./test/server-only-stub.ts"),
      },
    ],
  },
  test: {
    include: [
      "src/**/*.test.ts",
      "scripts/qa-agent/__tests__/**/*.test.mts",
    ],
    environment: "node",
  },
});
