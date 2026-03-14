module.exports = {
  apps: [{
    name: "planner-backend",
    script: "src/index.ts",
    interpreter: "bun",
    exec_mode: "fork",
    env: {
      NODE_ENV: "development",
    },
    env_production: {
      NODE_ENV: "production",
    },
  }],
};
