module.exports = {
  apps: [
    {
      name: 'resume-hr-server',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        PORT: 5000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000
      },
      // Auto-restart every 5 minutes in production
      cron_restart: '*/5 * * * *', // Every 5 minutes
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true
    },
    {
      name: 'production-manager',
      script: 'scripts/production-manager.js',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      },
      error_file: './logs/manager-err.log',
      out_file: './logs/manager-out.log',
      time: true
    }
  ]
};