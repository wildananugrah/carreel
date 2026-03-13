module.exports = {
  name: "market-websocket-app",
  script: "index.ts",
  instances: 1, // Bun doesn't support PM2 cluster mode - use 1 instance only
  exec_mode: "fork", // Use fork mode with Bun (not cluster)
  interpreter: "bun",
  env: {
    NODE_ENV: "production",
  },
  env_development: {
    NODE_ENV: "development",
  },
};