module.exports = {
  apps: [
    {
      name: "pipeline-backend",
      cwd: "./backend",
      script: "node",
      args: "dist/server.js",
      env: {
        NODE_ENV: "production",
        PORT: 4000,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      error_file: "logs/err.log",
      out_file: "logs/out.log",
      log_file: "logs/combined.log",
      time: true,
    },
  ],
};
