// PM2 process definitions for the Tracking App monorepo.
// Usage on a fresh VPS (from the repo root):
//   pm2 start pm2/ecosystem.config.js
//   pm2 save
//   pm2 startup

module.exports = {
  apps: [
    {
      name: "tracking.backend",
      script: "dist/index.js",
      cwd: "./backend",
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 8001,
      },
    },
    {
      name: "tracking.admin",
      script: "node_modules/.bin/next",
      args: "start -p 5001",
      cwd: "./admin",
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 5001,
        HOSTNAME: "0.0.0.0",
      },
    },
    {
      name: "tracking.user",
      script: "node_modules/.bin/next",
      args: "start -p 5002",
      cwd: "./user",
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 5002,
        HOSTNAME: "0.0.0.0",
      },
    },
  ],
};
