module.exports = {
  apps: [{
    name: "pipeline-ai",
    script: "./server.js",
    cwd: "/var/www/pipeline-ai",
    instances: 1,
    exec_mode: "fork",
    node_args: "--max-old-space-size=2048",
    env: {
      NODE_ENV: "production",
      PORT: 3000,
      HOSTNAME: "0.0.0.0",
    },
    max_memory_restart: "1500M",
    error_file: "/var/log/pipeline-ai/err.log",
    out_file: "/var/log/pipeline-ai/out.log",
    time: true,
    autorestart: true,
    watch: false,
  }],
};
