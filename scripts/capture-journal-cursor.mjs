import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const outputFlag = process.argv.indexOf('--output');
const requestedPath = outputFlag >= 0 ? process.argv[outputFlag + 1] : undefined;
if (!requestedPath || outputFlag !== process.argv.length - 2) {
	throw new Error('Usage: node scripts/capture-journal-cursor.mjs --output <protected-file>');
}

const journal = spawnSync('journalctl', ['--lines=0', '--show-cursor', '--no-pager'], {
	encoding: 'utf8',
	maxBuffer: 64 * 1024,
});
if (journal.status !== 0) throw new Error('Unable to capture the systemd journal cursor');
const cursor = journal.stdout.match(/^-- cursor: (.+)$/m)?.[1];
if (!cursor || /[\r\n]/.test(cursor)) throw new Error('Systemd returned an invalid journal cursor');

const outputPath = path.resolve(requestedPath);
const parentStat = fs.lstatSync(path.dirname(outputPath));
if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || (parentStat.mode & 0o077) !== 0) {
	throw new Error('Journal cursor parent must be a protected non-symlink directory');
}
const descriptor = fs.openSync(outputPath, 'wx', 0o600);
try {
	fs.writeFileSync(descriptor, cursor, {encoding: 'utf8'});
	fs.fsyncSync(descriptor);
} finally {
	fs.closeSync(descriptor);
}
fs.chmodSync(outputPath, 0o600);
console.log('PASS journal-cursor captured');
