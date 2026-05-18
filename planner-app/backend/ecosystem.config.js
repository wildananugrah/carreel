module.exports = {
  apps: [
    {
      name: "planner-backend",
      script: "src/index.ts",
      interpreter: "bun",
      // Same reusePort pattern as driver-backend. Planner is read-heavy
      // (dashboard, reviews) so 2 instances is sufficient.
      instances: 2,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        REUSEPORT: "true",
      },
      max_memory_restart: "512M",
      kill_timeout: 5000,
    },
  ],
};
