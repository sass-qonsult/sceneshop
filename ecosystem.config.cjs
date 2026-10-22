const fs = require("fs");
const path = require("path");

const hasSubdir = fs.existsSync(path.resolve(__dirname, "SceneShop_v0.19", "SceneShop", "server", "index.js"));
const targetDir = hasSubdir ? path.resolve(__dirname, "SceneShop_v0.19", "SceneShop") : __dirname;
const envFile = fs.existsSync(path.resolve(targetDir, ".env"))
  ? path.resolve(targetDir, ".env")
  : (fs.existsSync(path.resolve(__dirname, ".env")) ? path.resolve(__dirname, ".env") : "sceneshop.env");

module.exports = {
  apps: [
    {
      name: "sceneshop",
      cwd: targetDir,
      script: "server/index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: process.env.NODE_ENV || "production",
        PORT: process.env.PORT || 3000,
        DATA_BACKEND: process.env.DATA_BACKEND || "postgres",
        DATABASE_URL: process.env.DATABASE_URL || "",
        GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-3.1-pro-preview",
      },
      env_file: envFile,
      error_file: path.resolve(targetDir, "logs", "pm2-error.log"),
      out_file: path.resolve(targetDir, "logs", "pm2-out.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
  ],
};
