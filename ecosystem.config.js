// PM2 process config — run on the VPS with `pm2 start ecosystem.config.js`
module.exports = {
  apps: [{
    name: "deal-pipeline",
    script: "./server.js",
    cwd: "/home/ubuntu/deal-pipeline",
    instances: "max",          // one worker per CPU core
    exec_mode: "cluster",
    env: {
      NODE_ENV: "production",
      PORT: 3000,
      HOSTNAME: "0.0.0.0",
    },
    max_memory_restart: "1G",
    error_file: "./logs/err.log",
    out_file: "./logs/out.log",
    time: true,
  }],
};
