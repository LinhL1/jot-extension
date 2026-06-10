// Run once after cloning: node generate-config.js
// Reads VITE_GEMINI_API_KEY from .env and writes config.js (gitignored).
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
const outPath = path.join(__dirname, 'config.js');

let env;
try {
    env = fs.readFileSync(envPath, 'utf8');
} catch {
    console.error('Error: .env file not found.');
    process.exit(1);
}

const match = env.match(/^VITE_GEMINI_API_KEY=(.+)$/m);
if (!match || !match[1].trim()) {
    console.error('Error: VITE_GEMINI_API_KEY not found in .env');
    process.exit(1);
}

const key = match[1].trim();
fs.writeFileSync(outPath, `// Auto-generated from .env — do not commit\nvar GEMINI_API_KEY = '${key}';\n`);
console.log('config.js generated.');
