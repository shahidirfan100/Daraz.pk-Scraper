import { readFileSync } from 'fs';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));
const playwrightVersion = packageJson.dependencies?.playwright || packageJson.devDependencies?.playwright;

if (!playwrightVersion) {
    console.warn('⚠️  Playwright not found in package.json dependencies');
    process.exit(0);
}

console.log(`✓ Playwright version in package.json: ${playwrightVersion}`);
process.exit(0);
