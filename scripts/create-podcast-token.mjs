import {randomBytes} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const outputFlag = process.argv.indexOf('--output');
const requestedPath = outputFlag >= 0 ? process.argv[outputFlag + 1] : undefined;
if (!requestedPath || outputFlag !== process.argv.length - 2) {
	throw new Error('Usage: node scripts/create-podcast-token.mjs --output <protected-file>');
}

const outputPath = path.resolve(requestedPath);
const parent = path.dirname(outputPath);
if (!fs.existsSync(parent)) fs.mkdirSync(parent, {recursive: true, mode: 0o700});
const parentStat = fs.lstatSync(parent);
if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || (parentStat.mode & 0o077) !== 0) {
	throw new Error('Podcast token parent must be a protected non-symlink directory');
}

const token = randomBytes(32).toString('base64url');
const fd = fs.openSync(outputPath, 'wx', 0o600);
try {
	fs.writeFileSync(fd, token, {encoding: 'utf8'});
	fs.fsyncSync(fd);
} finally {
	fs.closeSync(fd);
}
fs.chmodSync(outputPath, 0o600);
console.log('Created a protected 256-bit LocalCast podcast token file with mode 600');
