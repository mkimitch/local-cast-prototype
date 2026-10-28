import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {armTrace, protectedDirectory, purgeTraces, readProtected, traceSchema} from './generationTrace';
import {replayTrace} from './replay';
import {traceReport} from './report';
import {createTraceExample} from './example';

try {
	const {values, positionals} = parseArgs({allowPositionals: true, options: {root: {type: 'string'}, station: {type: 'string'}, 'retention-hours': {type: 'string'}, all: {type: 'boolean'}}});
	const [command, file] = positionals;
	if (command === 'example' && values.root) {
		await createTraceExample(path.resolve(values.root));
		console.log('Synthetic capture created locally. No provider or database was used.');
	} else if (command === 'arm' && values.root && values.station) {
		armTrace(path.resolve(values.root), values.station, Number(values['retention-hours'] ?? 24));
		console.log('Armed for the next attempt of this station within one hour. No generation was started.');
	} else if (command === 'purge' && values.root) {
		console.log(`Purged ${purgeTraces(path.resolve(values.root), values.all)} captured attempts.`);
	} else if ((command === 'inspect' || command === 'replay') && file) {
		const filename = path.resolve(file);
		protectedDirectory(path.dirname(filename));
		const trace = traceSchema.parse(JSON.parse(readProtected(filename)));
		if (command === 'replay') {
			const result = replayTrace(trace);
			console.log(JSON.stringify(result, null, 2));
			if (result.deterministic !== 'PASS') process.exitCode = 2;
		} else {
			if (!/^trace-[0-9a-f-]{36}\.json$/.test(path.basename(filename))) throw new Error('Expected captured trace filename');
			const report = filename.replace(/\.json$/, '.html');
			const html = traceReport(trace);
			if (Buffer.byteLength(html) > 32 * 1024 * 1024) throw new Error('Report size limit exceeded');
			fs.writeFileSync(report, html, {flag: 'wx', mode: 0o600});
			console.log(report);
		}
	} else throw new Error('Usage: generation:trace arm --root DIR --station ID [--retention-hours 24] | inspect FILE | replay FILE | purge --root DIR [--all]');
} catch {
	// No untrusted payloads, paths, or parser errors in routine diagnostics.
	console.error('Trace command failed. Check command arguments, private file permissions, capture schema, and whether a report or arm already exists.');
	process.exitCode = 1;
}
