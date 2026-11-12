import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { existsSync, openSync, closeSync } from 'node:fs';
import { createSyntheticDatabase } from '../test/fixtures.js';

const { values } = parseArgs({ options: { output: { type: 'string' } } });
if (!values.output) throw new Error('Usage: npm run demo -- --output /absolute/path/synthetic.db');
const path = resolve(values.output);
if (existsSync(path)) throw new Error('Refusing to overwrite an existing file');
// Exclusive creation also protects against a race with another process.
closeSync(openSync(path, 'wx', 0o600));
const { db } = createSyntheticDatabase(path);
db.close();
process.stderr.write(`Synthetic database created at ${path}\nWorkspace ID: demo\n`);
