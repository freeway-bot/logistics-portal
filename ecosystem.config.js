module.exports = {
  apps: [{
    name:        'logistics-portal',
    script:      'server.js',
    watch:       false,
    autorestart: true,
    max_restarts: 10,
    env: {
      NODE_ENV: 'development',
      PORT:     3001,
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file:  'logs/pm2-error.log',
    out_file:    'logs/pm2-out.log',
    merge_logs:  true,
  }],
};
