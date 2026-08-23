import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

const productionRoots = ['server', 'src'];
const bannedPackages = [
	'@googleapis/calendar', '@pinecone-database/pinecone', 'amqplib', 'bull', 'bullmq', 'cheerio', 'chromadb',
	'electron', 'googleapis', 'ioredis', 'mixpanel', 'passport', 'posthog-js', 'puppeteer', 'redis', 'segment',
] as const;

const productionFiles = (): string[] => {
	const files: string[] = [];
	const visit = (directory: string): void => {
		for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
			const target = path.join(directory, entry.name);
			if (entry.isDirectory()) visit(target);
			else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(target);
		}
	};
	for (const root of productionRoots) visit(root);
	return files;
};

describe('product non-goal regression boundary', () => {
	it('keeps connector, scraper, account, vector, broker, analytics, and native-app packages out of production', () => {
		const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {dependencies?: Record<string, string>; devDependencies?: Record<string, string>};
		const installed = new Set([...Object.keys(packageJson.dependencies || {}), ...Object.keys(packageJson.devDependencies || {})]);
		expect(bannedPackages.filter(name => installed.has(name))).toEqual([]);

		const importPattern = /(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;
		const imported = productionFiles().flatMap(file => [...fs.readFileSync(file, 'utf8').matchAll(importPattern)].map(match => ({file, specifier: match[1]!})));
		expect(imported.filter(value => bannedPackages.some(name => value.specifier === name || value.specifier.startsWith(`${name}/`)))).toEqual([]);
	});
});
