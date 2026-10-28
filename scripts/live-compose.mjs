import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tokenSource = process.env.LOCALCAST_PODCAST_TOKEN_SOURCE;
const action = process.argv[2];
const actions = {
	build: ['build', 'app', 'worker'],
	deploy: ['up', '--detach', '--wait', '--wait-timeout', '90', 'app', 'worker'],
	'deploy-app': ['up', '--detach', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '90', 'app'],
};

if (!tokenSource || !actions[action] || process.argv.length !== 3) {
	throw new Error('Usage: LOCALCAST_PODCAST_TOKEN_SOURCE=<protected-file> node scripts/live-compose.mjs <build|deploy|deploy-app>');
}

const resolvedTokenSource = path.resolve(tokenSource);
const tokenStat = fs.lstatSync(resolvedTokenSource);
if (!tokenStat.isFile() || tokenStat.isSymbolicLink() || (tokenStat.mode & 0o077) !== 0) {
	throw new Error('Podcast token source must be a protected non-symlink file');
}

const appContainer = 'localcast-slice1-listening-app-1';
const markerProbe = [
	"const fs = require('node:fs');",
	"const paths = ['/var/lib/localcast/data/.localcast-installation.json', '/var/lib/localcast/media/.localcast-installation.json'];",
	"const values = paths.map(file => JSON.parse(fs.readFileSync(file, 'utf8')).installationId);",
	"process.stdout.write(JSON.stringify(values));",
].join('');
const markerResult = spawnSync('docker', ['exec', appContainer, 'node', '-e', markerProbe], {
	cwd: repoRoot,
	encoding: 'utf8',
	maxBuffer: 64 * 1024,
});
if (markerResult.status !== 0) throw new Error('Unable to read the persisted LocalCast installation markers');

let installationIds;
try {
	installationIds = JSON.parse(markerResult.stdout);
} catch {
	throw new Error('Persisted LocalCast installation markers returned invalid data');
}
if (
	!Array.isArray(installationIds)
	|| installationIds.length !== 2
	|| installationIds.some(value => typeof value !== 'string' || value.length < 16)
	|| installationIds[0] !== installationIds[1]
) {
	throw new Error('Persisted LocalCast installation markers do not agree');
}

const composeArguments = [
	'compose',
	'--project-name',
	'localcast-slice1-listening',
	'-f',
	path.join(repoRoot, 'compose.yml'),
	'-f',
	path.join(repoRoot, 'compose.caddy.yml'),
	...actions[action],
];
const composeResult = spawnSync('docker', composeArguments, {
	cwd: repoRoot,
	env: {
		...process.env,
		LOCALCAST_INSTALLATION_ID: installationIds[0],
		PUBLIC_BASE_URL: 'https://localcast.home.arpa',
		LOCALCAST_TRUSTED_ORIGINS: 'https://localcast.home.arpa',
		LOCALCAST_CADDY_NETWORK: 'caddy_default',
		LOCALCAST_PODCAST_TOKEN_SOURCE: resolvedTokenSource,
	},
	stdio: 'inherit',
});
if (composeResult.status !== 0) process.exit(composeResult.status ?? 1);
console.log(`PASS live-compose action=${action}`);
