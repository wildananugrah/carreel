const { config } = require("dotenv");
const { parsed: envVars } = config({ path: ".env" });

module.exports = {
  apps: [{
    name: "driver-backend",
    script: "src/index.ts",
    interpreter: "bun",
    exec_mode: "fork",
    env: {
      NODE_ENV: "development",
      ...envVars,
    }
  }],
};
