module.exports = {
  apps: [{
    name: 'lyserisai-frontend',
    script: 'npx',
    args: 'serve -s dist -l 5173',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    time: true
  }]
};
