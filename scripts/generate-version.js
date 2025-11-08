import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Generate version info
const version = {
  timestamp: Date.now(),
  date: new Date().toISOString(),
  buildId: Math.random().toString(36).substring(2, 15)
};

// Write to public directory (will be copied to dist during build)
const publicDir = join(__dirname, '..', 'public');
writeFileSync(
  join(publicDir, 'version.json'),
  JSON.stringify(version, null, 2)
);

console.log('Generated version.json:', version);
