import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Base de datos de pruebas aislada de la de desarrollo.
    env: {
      DATABASE_PATH: "./data/test.db",
      NODE_ENV: "test",
    },
    testTimeout: 15_000,
  },
});
