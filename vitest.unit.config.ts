import { defineProject } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineProject({
  test: {
    name: "unit",
    environment: "node",
    include: ["test/unit/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url)),
    },
  },
});
