import {describe, expect, it} from 'vitest';
import {parseBriefingRunRequest, parseCreateSourceInput, parseUpdateSourceInput} from '../../server/validation';

describe('RSS source API validation', () => {
	it('accepts and canonicalizes a credential-free HTTP(S) feed URL', () => {
		expect(parseCreateSourceInput({type: 'rss', name: 'Feed', url: 'HTTPS://Example.Test:443/feed?format=rss', isActive: true})).toEqual({
			ok: true,
			value: {type: 'rss', name: 'Feed', url: 'https://example.test/feed?format=rss', isActive: true},
		});
	});

	it.each([
		'file:///tmp/feed.xml',
		'https://user:password@example.test/feed',
		'https://example.test/feed#fragment',
		'https://example.test/feed?api_key=secret-canary',
		'https://example.test/feed?access-token=secret-canary',
		'https://example.test/feed?auth_token=secret-canary',
		'https://example.test/feed?session=secret-canary',
		'https://example.test/feed?jwt=secret-canary',
		'https://example.test/feed?credential=secret-canary',
	])('rejects unsafe or authenticated feed URL %s', url => {
		expect(parseCreateSourceInput({type: 'rss', name: 'Feed', url, isActive: true})).toMatchObject({ok: false});
		expect(parseUpdateSourceInput({url})).toMatchObject({ok: false});
	});

	it('rejects attempts to write server-owned source state', () => {
		expect(parseUpdateSourceInput({status: 'healthy'})).toMatchObject({ok: false});
		expect(parseUpdateSourceInput({lastSyncError: 'hide this'})).toMatchObject({ok: false});
	});

	it('preserves explicit metadata clearing and rejects obsolete source-only generation', () => {
		expect(parseUpdateSourceInput({category: null})).toEqual({ok: true, value: {category: null}});
		expect(parseBriefingRunRequest({stationId: 'station-1', mode: 'brief'})).toMatchObject({ok: true});
		expect(parseBriefingRunRequest({sourceIds: ['source-1']})).toMatchObject({ok: false});
	});
});
