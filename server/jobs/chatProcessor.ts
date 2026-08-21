import type {ServerConfig} from '../config';
import {OpenAiTextProvider} from '../providers/openai';
import {chatStore, type ChatStore} from '../services/chatStore';
import {approvedChatModel, type ChatProviderStageIdentity, type ClaimedChatTurn} from '../chat/types';
import {assertOpenAiEvidenceAuthorized} from './generationProcessor';
import {GenerationError} from './types';

export interface ChatProcessor {
	process(turn: ClaimedChatTurn, workerId: string, signal: AbortSignal): Promise<void>;
}

export interface EpisodeChatProvider {
	draftEpisodeQuestion: OpenAiTextProvider['draftEpisodeQuestion'];
	validateEpisodeQuestionSupport: OpenAiTextProvider['validateEpisodeQuestionSupport'];
}

class UnconfiguredChatProcessor implements ChatProcessor {
	async process(): Promise<void> {
		throw new GenerationError('PROVIDER_NOT_CONFIGURED', 'A supported server-side text provider is not configured', false);
	}
}

export class OpenAiChatProcessor implements ChatProcessor {
	private readonly provider: EpisodeChatProvider;

	constructor(
		config: ServerConfig,
		private readonly chats: ChatStore,
		apiKey: string,
		provider?: EpisodeChatProvider,
	) {
		this.provider = provider || new OpenAiTextProvider(apiKey, config.openAiTextModel);
	}

	async process(turn: ClaimedChatTurn, workerId: string, signal: AbortSignal): Promise<void> {
		const context = this.chats.loadGroundingContext(turn.id);
		assertOpenAiEvidenceAuthorized(context.evidence);
		let providerCallReserved = false;
		const identity: ChatProviderStageIdentity = {
			runId: turn.runId,
			turnId: turn.id,
			attemptNumber: turn.attemptCount,
			workerId,
		};
		try {
			const draftReservation = this.chats.reserveProviderCall(turn.id, workerId, 'draft', approvedChatModel);
			providerCallReserved = true;
			const draft = await this.provider.draftEpisodeQuestion(
				context,
				identity,
				draftReservation,
				signal,
			);
			if (draft.result.kind === 'refusal') {
				this.chats.completeRefusal(turn.id, workerId);
			} else {
				const supportReservation = this.chats.reserveProviderCall(turn.id, workerId, 'support', approvedChatModel);
				const support = await this.provider.validateEpisodeQuestionSupport(
					draft.result.claims,
					identity,
					supportReservation,
					signal,
				);
				this.chats.completeAnswer(turn.id, workerId, support.claims);
			}
		} catch (error) {
			if (error instanceof GenerationError) {
				throw error;
			}
			if (providerCallReserved) {
				throw new GenerationError(
					'CHAT_PUBLICATION_FAILED_AFTER_PROVIDER',
					'LocalCast could not publish a validated result after reserving external-provider work',
					false,
				);
			}
			throw error;
		}
	}
}

export const createChatProcessor = (config: ServerConfig, chats: ChatStore = chatStore): ChatProcessor => {
	if (config.textProvider === 'openai' && config.openAiApiKey) {
		return new OpenAiChatProcessor(config, chats, config.openAiApiKey);
	}
	return new UnconfiguredChatProcessor();
};
