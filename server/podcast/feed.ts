import {createHash} from 'node:crypto';
import type {PublishedPodcastEpisode} from '../services/podcastStore';
import type {PodcastAccess} from './token';

export interface SerializedPodcastFeed {
	body: Buffer;
	etag: string;
	lastModified?: Date;
}

const xmlSafe = (value: string): string => {
	let safe = '';
	for (const character of value) {
		const point = character.codePointAt(0) || 0;
		if (point === 0x9 || point === 0xa || point === 0xd || (point >= 0x20 && point <= 0xd7ff) || (point >= 0xe000 && point <= 0xfffd) || (point >= 0x10000 && point <= 0x10ffff)) {
			safe += character;
		} else {
			safe += '\uFFFD';
		}
	}
	return safe;
};

export const escapePodcastXml = (value: string): string => xmlSafe(value)
	.replaceAll('&', '&amp;')
	.replaceAll('<', '&lt;')
	.replaceAll('>', '&gt;')
	.replaceAll('"', '&quot;')
	.replaceAll("'", '&apos;');

const duration = (durationMs: number): string => {
	const totalSeconds = Math.max(1, Math.round(durationMs / 1_000));
	const hours = Math.floor(totalSeconds / 3_600);
	const minutes = Math.floor(totalSeconds % 3_600 / 60);
	const seconds = totalSeconds % 60;
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
		: `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const itemXml = (episode: PublishedPodcastEpisode, access: PodcastAccess): string => {
	const browserUrl = `${access.publicBaseUrl}/episodes/${encodeURIComponent(episode.runId)}`;
	const description = `${episode.description} This LocalCast episode and its voice are AI-generated from cited supplied material.`;
	return [
		'\t\t<item>',
		`\t\t\t<title>${escapePodcastXml(episode.title)}</title>`,
		`\t\t\t<description>${escapePodcastXml(description)}</description>`,
		`\t\t\t<link>${escapePodcastXml(browserUrl)}</link>`,
		`\t\t\t<guid isPermaLink="false">${escapePodcastXml(`urn:localcast:episode:${episode.runId}`)}</guid>`,
		`\t\t\t<pubDate>${escapePodcastXml(new Date(episode.completedAt).toUTCString())}</pubDate>`,
		`\t\t\t<itunes:duration>${duration(episode.durationMs)}</itunes:duration>`,
		'\t\t\t<itunes:explicit>false</itunes:explicit>',
		`\t\t\t<enclosure url="${escapePodcastXml(access.enclosureUrl(episode.runId))}" length="${episode.byteLength}" type="audio/mpeg" />`,
		'\t\t</item>',
	].join('\n');
};

export const serializePodcastFeed = (
	episodes: PublishedPodcastEpisode[],
	access: PodcastAccess,
): SerializedPodcastFeed => {
	const feedUrl = access.feedUrl();
	const latest = episodes[0] ? new Date(episodes[0].completedAt) : undefined;
	const body = Buffer.from([
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">',
		'\t<channel>',
		'\t\t<title>LocalCast private podcast</title>',
		`\t\t<link>${escapePodcastXml(access.publicBaseUrl)}</link>`,
		'\t\t<description>Private source-grounded LocalCast episodes. All voices and audio are AI-generated.</description>',
		'\t\t<language>en-us</language>',
		'\t\t<generator>LocalCast</generator>',
		'\t\t<itunes:author>LocalCast</itunes:author>',
		'\t\t<itunes:explicit>false</itunes:explicit>',
		'\t\t<podcast:medium>podcast</podcast:medium>',
		`\t\t<atom:link href="${escapePodcastXml(feedUrl)}" rel="self" type="application/rss+xml" />`,
		...(latest && Number.isFinite(latest.getTime()) ? [`\t\t<lastBuildDate>${latest.toUTCString()}</lastBuildDate>`] : []),
		...episodes.map(episode => itemXml(episode, access)),
		'\t</channel>',
		'</rss>',
		'',
	].join('\n'), 'utf8');
	return {
		body,
		etag: `"${createHash('sha256').update(body).digest('hex')}"`,
		lastModified: latest && Number.isFinite(latest.getTime()) ? latest : undefined,
	};
};
