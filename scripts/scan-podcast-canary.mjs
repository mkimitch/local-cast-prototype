import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argumentsByName = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
	argumentsByName.set(process.argv[index], process.argv[index + 1]);
}

const tokenFile = argumentsByName.get('--token-file');
const journalCursorFile = argumentsByName.get('--journal-cursor-file');
const caddyContainer = argumentsByName.get('--caddy-container') || 'caddy';
const appContainer = argumentsByName.get('--app-container');
const workerContainer = argumentsByName.get('--worker-container');
const image = argumentsByName.get('--image') || 'localcast:prototype';
if (!tokenFile || !journalCursorFile || !appContainer || !workerContainer) {
	throw new Error('Usage: node scripts/scan-podcast-canary.mjs --token-file <path> --journal-cursor-file <path> --app-container <name-or-id> --worker-container <name-or-id> [--caddy-container <name-or-id>] [--image <reference>]');
}

const tokenStat = fs.lstatSync(tokenFile);
if (!tokenStat.isFile() || tokenStat.isSymbolicLink() || (tokenStat.mode & 0o077) !== 0) {
	throw new Error('Canary token file is not protected');
}
const token = fs.readFileSync(tokenFile, 'utf8').replace(/\r?\n$/, '');
if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Canary token file is malformed');
const rejectedTokenBytes = Buffer.from(token, 'base64url');
rejectedTokenBytes[0] ^= 0x01;
const needles = [Buffer.from(token, 'utf8'), Buffer.from(rejectedTokenBytes.toString('base64url'), 'utf8')];
const maximumNeedleLength = Math.max(...needles.map(value => value.byteLength));
const excludedCanaryPath = path.resolve(tokenFile);

const countBuffer = buffer => {
	let matches = 0;
	for (const needle of needles) {
		let offset = 0;
		while (offset <= buffer.byteLength - needle.byteLength) {
			const match = buffer.indexOf(needle, offset);
			if (match === -1) break;
			matches += 1;
			offset = match + 1;
		}
	}
	return matches;
};

const scanFile = file => {
	if (path.resolve(file) === excludedCanaryPath) return {matches: 0, files: 0, excluded: 1, errors: 0};
	if (file.endsWith('.gz')) {
		const result = runCaptured('gzip', ['-cd', file]);
		return {...result, files: 1};
	}
	if (file.endsWith('.zip')) {
		const result = runCaptured('busybox', ['unzip', '-p', file]);
		return {...result, files: 1};
	}
	const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
	const buffer = Buffer.allocUnsafe(256 * 1024);
	let carry = Buffer.alloc(0);
	let matches = 0;
	try {
		for (;;) {
			const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.byteLength, null);
			if (bytesRead === 0) break;
			const combined = Buffer.concat([carry, buffer.subarray(0, bytesRead)]);
			let offset = 0;
			for (const needle of needles) {
				offset = 0;
				while (offset <= combined.byteLength - needle.byteLength) {
					const match = combined.indexOf(needle, offset);
					if (match === -1) break;
					if (match + needle.byteLength > carry.byteLength) matches += 1;
					offset = match + 1;
				}
			}
			carry = combined.subarray(Math.max(0, combined.byteLength - maximumNeedleLength + 1));
		}
	} finally {
		fs.closeSync(descriptor);
	}
	return {matches, files: 1, excluded: 0, errors: 0};
};

const add = (left, right) => ({
	matches: left.matches + right.matches,
	files: left.files + right.files,
	excluded: left.excluded + right.excluded,
	errors: left.errors + right.errors,
});

const empty = () => ({matches: 0, files: 0, excluded: 0, errors: 0});

const scanTree = (root, options = {}) => {
	const aggregate = empty();
	const allowedRoot = path.resolve(root);
	const pending = [allowedRoot];
	const visitedDirectories = new Set();
	const isWithinRoot = candidate => {
		const relative = path.relative(allowedRoot, candidate);
		return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
	};
	while (pending.length > 0) {
		const current = pending.pop();
		let stat;
		try {
			stat = fs.lstatSync(current);
		} catch {
			aggregate.errors += 1;
			continue;
		}
		if (stat.isSymbolicLink()) {
			try {
				aggregate.matches += countBuffer(Buffer.from(fs.readlinkSync(current), 'utf8'));
				aggregate.files += 1;
				const resolved = fs.realpathSync(current);
				if (!isWithinRoot(resolved)) {
					continue;
				}
				const targetStat = fs.statSync(resolved);
				if (targetStat.isFile()) Object.assign(aggregate, add(aggregate, scanFile(resolved)));
				else if (targetStat.isDirectory()) pending.push(resolved);
			} catch {
				aggregate.errors += 1;
			}
			continue;
		}
		if (stat.isDirectory()) {
			if (visitedDirectories.has(current)) continue;
			visitedDirectories.add(current);
			let entries;
			try {
				entries = fs.readdirSync(current, {withFileTypes: true});
			} catch {
				aggregate.errors += 1;
				continue;
			}
			for (const entry of entries) {
				if (options.skip?.(current, entry.name)) continue;
				pending.push(path.join(current, entry.name));
			}
			continue;
		}
		if (!stat.isFile()) continue;
		try {
			Object.assign(aggregate, add(aggregate, scanFile(current)));
		} catch {
			aggregate.errors += 1;
		}
	}
	return aggregate;
};

const runCaptured = (command, arguments_, options = {}) => {
	const result = spawnSync(command, arguments_, {
		cwd: repoRoot,
		encoding: null,
		maxBuffer: 512 * 1024 * 1024,
		...options,
	});
	const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
	const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0);
	return {
		matches: countBuffer(Buffer.concat([stdout, stderr])),
		files: 1,
		excluded: 0,
		errors: result.status === 0 ? 0 : 1,
		stdout,
	};
};

const scanContainerFiles = (container, roots, predicate = () => true, requireFiles = false) => {
	const listing = runCaptured('docker', ['exec', container, 'find', ...roots, '-type', 'f', '-print0']);
	const aggregate = {...listing, files: 0};
	if (listing.errors > 0) return aggregate;
	const files = listing.stdout.toString('utf8').split('\0').filter(Boolean).filter(predicate);
	if (requireFiles && files.length === 0) aggregate.errors += 1;
	for (const file of files) {
		const result = file.endsWith('.gz')
			? runCaptured('docker', ['exec', container, 'gzip', '-cd', file])
			: runCaptured('docker', ['exec', container, 'cat', file]);
		aggregate.matches += result.matches;
		aggregate.files += result.files;
		aggregate.errors += result.errors;
	}
	return aggregate;
};

const cursor = fs.readFileSync(journalCursorFile, 'utf8').trim();
if (!cursor || /[\r\n]/.test(cursor)) throw new Error('Journal cursor file is malformed');

const results = [];
results.push(['caddy-runtime-files', scanContainerFiles(
	caddyContainer,
	['/config'],
	file => path.posix.basename(file).startsWith('caddy-runtime'),
	true,
)]);

let dockerLogs = empty();
for (const container of [caddyContainer, appContainer, workerContainer]) {
	dockerLogs = add(dockerLogs, runCaptured('docker', ['logs', '--timestamps', container]));
	const logPathResult = runCaptured('docker', ['inspect', '--format', '{{.LogPath}}', container]);
	dockerLogs = add(dockerLogs, {...logPathResult, matches: logPathResult.matches, files: 0});
	if (logPathResult.errors === 0) {
		const logPath = logPathResult.stdout.toString('utf8').trim();
		if (!path.isAbsolute(logPath) || /[\r\n]/.test(logPath)) {
			dockerLogs.errors += 1;
		} else {
			let entries = [];
			let retainedFiles = 0;
			try {
				entries = fs.readdirSync(path.dirname(logPath));
			} catch {
				dockerLogs.errors += 1;
			}
			for (const entry of entries) {
				if (entry !== path.basename(logPath) && !entry.startsWith(`${path.basename(logPath)}.`)) continue;
				retainedFiles += 1;
				dockerLogs = add(dockerLogs, scanTree(path.join(path.dirname(logPath), entry)));
			}
			if (retainedFiles === 0) dockerLogs.errors += 1;
		}
	}
}
results.push(['docker-json-logs', dockerLogs]);

results.push(['systemd-journal', runCaptured('journalctl', ['--after-cursor', cursor, '--output', 'cat', '--no-pager'])]);
results.push(['/var/log', scanTree('/var/log')]);
results.push(['caddy-data-config', scanContainerFiles(caddyContainer, ['/config', '/data', '/etc/caddy/Caddyfile'])]);
results.push(['localcast-data-media', scanContainerFiles(appContainer, ['/var/lib/localcast/data', '/var/lib/localcast/media'])]);

const repoResult = scanTree(repoRoot, {
	skip: (parent, name) => parent === repoRoot && name === 'node_modules',
});
for (const arguments_ of [
	['diff', '--no-ext-diff', '--binary'],
	['diff', '--cached', '--no-ext-diff', '--binary'],
	['status', '--short', '--untracked-files=all'],
]) {
	Object.assign(repoResult, add(repoResult, runCaptured('git', ['-c', `safe.directory=${repoRoot}`, ...arguments_])));
}
results.push(['repository-and-git-diff', repoResult]);

const tmpAggregate = empty();
let tmpEntries = [];
try {
	tmpEntries = fs.readdirSync('/tmp', {withFileTypes: true});
} catch {
	tmpAggregate.errors += 1;
}
for (const entry of tmpEntries) {
	if (!/(localcast|playwright|npm|smoke|screenshot|trace|test-results)/i.test(entry.name)) continue;
	Object.assign(tmpAggregate, add(tmpAggregate, scanTree(path.join('/tmp', entry.name))));
}
results.push(['/tmp-relevant-artifacts', tmpAggregate]);

let metadata = empty();
metadata = add(metadata, runCaptured('docker', ['container', 'inspect', caddyContainer, appContainer, workerContainer]));
metadata = add(metadata, runCaptured('docker', ['image', 'inspect', image]));
metadata = add(metadata, runCaptured('docker', ['image', 'history', '--no-trunc', image]));
results.push(['container-metadata-image-history', metadata]);

let failed = false;
for (const [sink, result] of results) {
	const status = result.matches === 0 && result.errors === 0 ? 'PASS' : 'FAIL';
	if (status === 'FAIL') failed = true;
	console.log(`${status} sink=${sink} matches=${result.matches} files=${result.files} excluded=${result.excluded} errors=${result.errors}`);
}

if (failed) process.exitCode = 1;
