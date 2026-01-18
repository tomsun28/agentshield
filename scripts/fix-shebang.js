#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const filePath = join(__dirname, '../dist/index.js');
let content = readFileSync(filePath, 'utf8');

// Remove any existing shebang and add Node.js shebang
content = content.replace(/^#!.*\n?/, '');
content = '#!/usr/bin/env node\n' + content;

writeFileSync(filePath, content, 'utf8');
