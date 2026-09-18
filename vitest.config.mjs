import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { fileURLToPath, URL } from "node:url";
import { join } from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const root = fileURLToPath(new URL(".", import.meta.url));

  return {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    test: {
      environment: "happy-dom",
      globals: true,
      include: ["tests/**/*.test.{js,jsx}"],
      setupFiles: ["./tests/setup.js"],
      fileParallelism: false,

      env: {
        DATABASE_URL: env.DATABASE_URL_TEST,
        NEWS_DIR: join(root, "tests", "fixtures", "news"),
        S3_ENDPOINT: env.S3_ENDPOINT_TEST,
        S3_REGION: env.S3_REGION_TEST,
        S3_ACCESS_KEY: env.S3_ACCESS_KEY_TEST,
        S3_SECRET_KEY: env.S3_SECRET_KEY_TEST,
        S3_BUCKET: env.S3_BUCKET_TEST,
        S3_PUBLIC_URL: env.S3_PUBLIC_URL_TEST,
      },

      server: {
        deps: {
          inline: ["next-auth", "next"],
        },
      },

      coverage: {
        provider: "v8",
        include: [
          "src/lib/repositories/**/*.js",
          "src/lib/queue-server.js",
          "src/lib/prisma-client.js",
          "src/lib/event-manager.js",
          "src/lib/hooks/**/*.js",
          "src/app/api/**/*.js",
          "src/middleware.js",
        ],
        exclude: [
          "tests/**",
          "src/**/*.test.{js,jsx}",
          "src/**/*.module.css",
        ],
        reporter: ["text", "html", "json-summary"],
      },
    },
  };
});
