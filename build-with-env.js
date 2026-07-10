#!/usr/bin/env node

/**
 * Build script that injects environment variables into index.html
 * Usage: node build-with-env.js [--production]
 */

const fs = require('fs');
const path = require('path');

// Load environment variables from .env.local or .env
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Get the API key from environment
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

if (!GOOGLE_MAPS_API_KEY) {
  console.error('❌ ERROR: GOOGLE_MAPS_API_KEY not found in environment variables');
  console.error('Please create a .env.local file with your API key');
  console.error('Copy from .env.example and add your actual key');
  process.exit(1);
}

// Read the template
const templatePath = path.join(__dirname, 'dist', 'index.html.template');
const outputPath = path.join(__dirname, 'dist', 'index.html');

// If template doesn't exist, read current index.html as template
const templateContent = fs.existsSync(templatePath)
  ? fs.readFileSync(templatePath, 'utf8')
  : fs.readFileSync(outputPath, 'utf8');

// Replace the placeholder
const outputContent = templateContent.replace(
  /key=GOOGLE_MAPS_API_KEY_PLACEHOLDER|key=[A-Za-z0-9_-]{39,}/,
  `key=${GOOGLE_MAPS_API_KEY}`
);

// Write the output
fs.writeFileSync(outputPath, outputContent, 'utf8');
console.log('✅ index.html generated with API key injected');
console.log(`   API Key: ${GOOGLE_MAPS_API_KEY.substring(0, 10)}...`);
