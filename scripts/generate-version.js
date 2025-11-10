import { writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get git commit info
let gitHash = 'unknown';
let commitMessage = 'No commit info available';
try {
  gitHash = execSync('git rev-parse --short HEAD').toString().trim();
  const fullMessage = execSync('git log -1 --pretty=%B').toString().trim();
  // Get first 8 words of commit message
  const words = fullMessage.split(/\s+/);
  commitMessage = words.slice(0, 8).join(' ');
  if (words.length > 8) {
    commitMessage += '...';
  }
} catch (error) {
  console.warn('Failed to get git info:', error.message);
}

// Generate version info
const version = {
  timestamp: Date.now(),
  date: new Date().toISOString(),
  buildId: Math.random().toString(36).substring(2, 15),
  gitHash,
  commitMessage
};

// Write to public directory (will be copied to dist during build)
const publicDir = join(__dirname, '..', 'public');
writeFileSync(
  join(publicDir, 'version.json'),
  JSON.stringify(version, null, 2)
);

console.log('Generated version.json:', version);
