import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Only the dependency-free logic units are run in CI. Route/db tests
    // would require a Postgres service; that is a deliberate, documented gap.
    include: ["src/lib/**/*.test.ts"],
  },
});
