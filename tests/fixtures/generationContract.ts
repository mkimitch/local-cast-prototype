import {createHash} from 'node:crypto';
import type {EpisodeEvidence, EpisodeRequestSnapshot} from '../../server/episodes/types';

// Synthetic analogues of the failure mechanisms, not copied personal trace data.
export const contractRequest: EpisodeRequestSnapshot = {
	id: 'synthetic-request', runId: 'synthetic-run', stationId: 'synthetic-station',
	stationRevision: 1, stationName: 'Synthetic briefing', mode: 'brief', briefLengthPreset: 'compact',
	topicInstruction: 'Choose two useful stories. Use a natural opening and closing. Include relevant upcoming personal obligations On your radar.',
	requestHash: 'synthetic', requestedAt: '2026-11-03T10:00:00.000Z',
};
const source = (id: string, kind: 'note' | 'feed', title: string, body: string): EpisodeEvidence => ({
	id, originalId: id, kind, title, body, contentSha256: createHash('sha256').update(body).digest('hex'),
	networkScope: kind === 'note' ? 'user_supplied' : 'public',
	...(kind === 'feed' ? {author: 'Metadata author', originalUrl: 'https://example.test/headline-only-event', publishedAt: '2026-11-03T09:00:00.000Z'} : {}),
});
export const contractEvidence = [
	source('note-reminder', 'note', 'Private agenda title', 'An interview with Example Workshop is scheduled for November 4, 2026 at 3:00 PM Central Time. The meeting will take place by video call.'),
	source('feed-pause', 'feed', 'Deliveries resume after pause', 'The coordinator said deliveries had been paused at the port following a request from the council. The coordinator expressed frustration with that request during a radio interview.'),
	source('feed-delay', 'feed', 'Software glitch delays 900,000 registrations before voting', 'Civic groups sued the regional agency over delayed registrations that overwhelmed local workers. The groups filed their case on Monday and asked the agency to address the delays.'),
];
export const supportedContractDraft = {sections: [
	{title: 'Model heading is not evidence', type: 'intro', segments: [{kind: 'factual', text: 'The coordinator said deliveries had been paused following a council request.', citations: ['E02']}]},
	{title: 'Summary', type: 'news_summary', segments: [{kind: 'factual', text: 'Civic groups sued the regional agency over registration delays that overwhelmed local workers. They filed the case on Monday.', citations: ['E03']}]},
	{title: 'On your radar', type: 'outro', segments: [{kind: 'factual', text: 'An interview with Example Workshop is scheduled for November 4, 2026 at 3:00 PM Central Time, by video call.', citations: ['E01']}]},
]};
