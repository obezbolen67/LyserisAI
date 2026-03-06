const fs = require('fs');
const path = require('path');

/**
 * Parse a .env file and return an object with key-value pairs
 */
function loadEnvFile(envPath) {
  const result = {};
  if (!fs.existsSync(envPath)) {
    console.warn(`[ecosystem] Warning: ${envPath} not found, skipping`);
    return result;
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const envFile = loadEnvFile(path.join(__dirname, '.env'));

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
      ...envFile,
      NODE_ENV: 'production'
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    time: true
  }]
};
