module.exports = {
  apps: [
    {
      name: "driver-backend",
      script: "src/index.ts",
      interpreter: "bun",
      // instances + reusePort: on Linux, multiple processes share the port via
      // SO_REUSEPORT (kernel load-balances incoming connections). This is NOT
      // Node.js cluster — Bun doesn't use cluster module. Each instance is a
      // fully independent process, so pgboss workers multiply too (all 3
      // instances poll the same job queue; that's fine, pgboss is safe for
      // multi-consumer). Set DB_POOL_SIZE per instance so total connections
      // stay under Postgres max_connections (200): 3 × 25 = 75 driver +
      // 2 × 25 = 50 planner = 125, leaving headroom for pgboss and admin.
      instances: 3,
      exec_mode: "fork",
      // reusePort is passed as an env to the process; Bun.serve reads it.
      // If your Bun version doesn't support reusePort, set instances: 1.
      env: {
        NODE_ENV: "production",
        REUSEPORT: "true",
      },
      // Restart if memory exceeds 512 MB (Gemini responses can be large).
      max_memory_restart: "512M",
      // Wait 5 s for graceful shutdown before kill.
      kill_timeout: 5000,
    },
  ],
};
