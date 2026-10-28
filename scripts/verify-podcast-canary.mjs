import {createHash} from 'node:crypto';
import fs from 'node:fs';
import Parser from 'rss-parser';

const argumentsByName = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
	argumentsByName.set(process.argv[index], process.argv[index + 1]);
}
const tokenFile = argumentsByName.get('--token-file');
const origin = argumentsByName.get('--origin');
const mode = argumentsByName.get('--mode') || 'functional';
if (!tokenFile || !origin || !['functional', 'outage'].includes(mode)) {
	throw new Error('Usage: node scripts/verify-podcast-canary.mjs --token-file <path> --origin <origin> [--mode functional|outage]');
}

const stat = fs.lstatSync(tokenFile);
if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error('Canary token file is not protected');
const token = fs.readFileSync(tokenFile, 'utf8').replace(/\r?\n$/, '');
if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Canary token file is malformed');
const rejectedTokenBytes = Buffer.from(token, 'base64url');
rejectedTokenBytes[0] ^= 0x01;
const rejectedToken = rejectedTokenBytes.toString('base64url');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const requireAssertion = (condition, id) => {
	if (!condition) throw new Error(`Canary assertion failed: ${id}`);
};
const request = async (url, init = {}) => {
	try {
		return await fetch(url, {redirect: 'error', ...init});
	} catch {
		throw new Error('Canary HTTPS request failed');
	}
};
const read = async response => {
	let body;
	try {
		body = Buffer.from(await response.arrayBuffer());
	} catch {
		throw new Error('Canary HTTPS response body could not be read');
	}
	return {
		status: response.status,
		body,
		length: body.byteLength,
		sha256: sha256(body),
		contentLength: response.headers.get('content-length'),
		contentType: response.headers.get('content-type'),
		cacheControl: response.headers.get('cache-control'),
		contentRange: response.headers.get('content-range'),
		acceptRanges: response.headers.get('accept-ranges'),
	};
};
const report = (id, method, record) => {
	console.log(`PASS assertion=${id} method=${method} status=${record.status} length=${record.length} sha256=${record.sha256}`);
};
const safeUrl = value => {
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
};
const sameRejectedGet = (left, right) => (
	left.status === right.status
	&& left.length === right.length
	&& left.sha256 === right.sha256
	&& left.contentLength === right.contentLength
	&& left.contentType === right.contentType
	&& left.cacheControl === right.cacheControl
);
const sameRejectedHead = (head, get) => (
	head.status === get.status
	&& head.length === 0
	&& head.contentLength === get.contentLength
	&& head.contentType === get.contentType
	&& head.cacheControl === get.cacheControl
);

const acceptedFeedUrl = `${origin}/podcast/${encodeURIComponent(token)}/feed.xml`;

if (mode === 'outage') {
	const outage = await read(await request(acceptedFeedUrl));
	requireAssertion([502, 503, 504].includes(outage.status), 'caddy-runtime-error-path');
	report('caddy-runtime-error-path', 'GET', outage);
	process.exit(0);
}

const feedGet = await read(await request(acceptedFeedUrl));
requireAssertion(feedGet.status === 200 && feedGet.length > 0, 'feed-get');
report('feed-get', 'GET', feedGet);
const feedHead = await read(await request(acceptedFeedUrl, {method: 'HEAD'}));
requireAssertion(feedHead.status === 200 && feedHead.length === 0 && feedHead.contentLength === String(feedGet.length), 'feed-head');
report('feed-head', 'HEAD', feedHead);

let parsed;
try {
	parsed = await new Parser().parseString(feedGet.body.toString('utf8'));
} catch {
	throw new Error('Canary feed XML parsing failed');
}
const enclosureUrl = parsed.items[0]?.enclosure?.url;
const enclosure = typeof enclosureUrl === 'string' ? safeUrl(enclosureUrl) : undefined;
requireAssertion(Boolean(enclosure && enclosure.origin === origin), 'feed-enclosure-origin');

const enclosureGet = await read(await request(enclosureUrl));
requireAssertion(enclosureGet.status === 200 && enclosureGet.length > 1_024 && enclosureGet.contentType?.startsWith('audio/mpeg') && enclosureGet.acceptRanges === 'bytes', 'enclosure-get');
report('enclosure-get', 'GET', enclosureGet);
const enclosureHead = await read(await request(enclosureUrl, {method: 'HEAD'}));
requireAssertion(enclosureHead.status === 200 && enclosureHead.length === 0 && enclosureHead.contentLength === String(enclosureGet.length), 'enclosure-head');
report('enclosure-head', 'HEAD', enclosureHead);
const enclosureRange = await read(await request(enclosureUrl, {headers: {Range: 'bytes=0-1023'}}));
requireAssertion(enclosureRange.status === 206 && enclosureRange.length === 1_024 && enclosureRange.contentRange === `bytes 0-1023/${enclosureGet.length}` && enclosureRange.body.equals(enclosureGet.body.subarray(0, 1_024)), 'enclosure-range');
report('enclosure-range', 'GET', enclosureRange);

const wrongFeedUrl = `${origin}/podcast/${rejectedToken}/feed.xml`;
const missingFeedUrl = `${origin}/podcast/feed.xml`;
const malformedFeedUrl = `${origin}/podcast/malformed/feed.xml`;
const wrongGet = await read(await request(wrongFeedUrl));
const missingGet = await read(await request(missingFeedUrl));
const malformedGet = await read(await request(malformedFeedUrl));
requireAssertion(wrongGet.status === 404 && sameRejectedGet(wrongGet, missingGet) && sameRejectedGet(wrongGet, malformedGet), 'rejected-feed-equivalence');
report('rejected-feed-wrong', 'GET', wrongGet);
report('rejected-feed-missing', 'GET', missingGet);
report('rejected-feed-malformed', 'GET', malformedGet);
const wrongFeedHead = await read(await request(wrongFeedUrl, {method: 'HEAD'}));
requireAssertion(sameRejectedHead(wrongFeedHead, wrongGet), 'rejected-feed-head');
report('rejected-feed-head', 'HEAD', wrongFeedHead);

const enclosureSegments = enclosure.pathname.split('/');
enclosureSegments[2] = rejectedToken;
const wrongEnclosureUrl = `${origin}${enclosureSegments.join('/')}`;
const wrongEnclosureGet = await read(await request(wrongEnclosureUrl));
const wrongEnclosureHead = await read(await request(wrongEnclosureUrl, {method: 'HEAD'}));
const wrongEnclosureRange = await read(await request(wrongEnclosureUrl, {headers: {Range: 'bytes=0-1023'}}));
requireAssertion(sameRejectedGet(wrongGet, wrongEnclosureGet), 'rejected-enclosure-get');
requireAssertion(sameRejectedHead(wrongEnclosureHead, wrongEnclosureGet), 'rejected-enclosure-head');
requireAssertion(sameRejectedGet(wrongEnclosureGet, wrongEnclosureRange), 'rejected-enclosure-range');
report('rejected-enclosure-get', 'GET', wrongEnclosureGet);
report('rejected-enclosure-head', 'HEAD', wrongEnclosureHead);
report('rejected-enclosure-range', 'GET', wrongEnclosureRange);
