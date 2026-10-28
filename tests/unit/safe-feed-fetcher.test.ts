import {describe, expect, it} from 'vitest';
import {classifyFeedAddress, normalizeFeedHostname, parseFeedUrl, sameFeedAddress} from '../../server/services/safeFeedFetcher';

describe('feed destination policy primitives', () => {
	it.each([
		['8.8.8.8', 'public'],
		['2606:4700:4700::1111', 'public'],
		['10.0.0.1', 'private'],
		['172.16.2.3', 'private'],
		['192.168.1.4', 'private'],
		['127.0.0.1', 'private'],
		['::1', 'private'],
		['fd00::1', 'private'],
		['::ffff:127.0.0.1', 'private'],
		['::ffff:7f00:1', 'private'],
		['169.254.169.254', 'always_blocked'],
		['100.100.100.200', 'always_blocked'],
		['100.64.0.1', 'always_blocked'],
		['0.0.0.0', 'always_blocked'],
		['224.0.0.1', 'always_blocked'],
		['198.51.100.2', 'always_blocked'],
		['fe80::1', 'always_blocked'],
		['ff02::1', 'always_blocked'],
		['2001:db8::1', 'always_blocked'],
		['fd00:ec2::254', 'always_blocked'],
	])('classifies %s as %s', (address, expected) => {
		expect(classifyFeedAddress(address)).toBe(expected);
	});

	it('normalizes exact allowlist hostnames without suffix matching', () => {
		expect(normalizeFeedHostname('Feed.Example.Test.')).toBe('feed.example.test');
		expect(normalizeFeedHostname('feed.example.test.evil')).not.toBe(normalizeFeedHostname('feed.example.test'));
	});

	it.each([
		'file:///tmp/feed.xml',
		'https://user:secret@example.test/feed.xml',
		'https://example.test/feed.xml#fragment',
		'https://example.test/feed.xml?token=secret-canary',
		'https://example.test/feed.xml?auth_token=secret-canary',
		'https://example.test/feed.xml?session=secret-canary',
		'https://example.test/feed.xml?jwt=secret-canary',
		'https://example.test/feed.xml?credential=secret-canary',
		'javascript:alert(1)',
		'',
	])('rejects unsafe URL %s', value => {
		expect(() => parseFeedUrl(value)).toThrow(/credential-free HTTP\(S\)/);
	});

	it('canonicalizes alternate numeric IPv4 syntax before policy evaluation', () => {
		expect(parseFeedUrl('http://2130706433/feed').hostname).toBe('127.0.0.1');
	});

	it('compares pinned and connected addresses after normalization', () => {
		expect(sameFeedAddress('127.0.0.1', '127.0.0.1')).toBe(true);
		expect(sameFeedAddress('::ffff:127.0.0.1', '127.0.0.1')).toBe(true);
		expect(sameFeedAddress('127.0.0.1', '127.0.0.2')).toBe(false);
		expect(sameFeedAddress('2606:4700:4700::1111', '2606:4700:4700::1001')).toBe(false);
	});
});
