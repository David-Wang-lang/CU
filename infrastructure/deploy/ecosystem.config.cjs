/**
 * PM2 process file for CU on the VPS.
 * Paths go through CU_APP_DIR (/home/deploy/cu/app → current release).
 */
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = process.env.CU_APP_DIR || __dirname;
const app = (dir) => path.join(root, dir);

let revision = "dev";
try {
  revision = readFileSync(app("REVISION"), "utf8").trim();
} catch {
  // local checkout
}

const sharedEnvPath = process.env.CU_ENV_FILE || path.join(root, "..", "shared", ".env");
const env = {
  NODE_ENV: "production",
  APP_REVISION: revision,
  // API / dashboard load secrets from process env; deploy.sh exports from shared/.env
};

module.exports = {
  apps: [
    {
      name: "cu-api",
      cwd: app("apps/api"),
      script: "uv",
      args: "run uvicorn app.main:app --host 127.0.0.1 --port 4000 --workers 2",
      interpreter: "none",
      max_memory_restart: "800M",
      kill_timeout: 10000,
      env: {
        ...env,
        API_HOST: "127.0.0.1",
        API_PORT: "4000",
      },
    },
    {
      name: "cu-dashboard",
      cwd: app("apps/dashboard"),
      script: "node",
      args: "server.js",
      // standalone output places server.js under apps/dashboard after deploy layout
      max_memory_restart: "700M",
      env: {
        ...env,
        PORT: "4001",
        HOSTNAME: "127.0.0.1",
      },
    },
  ],
};
