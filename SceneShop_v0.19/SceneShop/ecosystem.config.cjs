module.exports = {
  apps: [
    {
      name: "sceneshop",
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
      },
      env_file: "sceneshop.env",
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
  ],
};
