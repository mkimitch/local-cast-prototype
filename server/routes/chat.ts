import {Router} from 'express';
import type {Response} from 'express';
import {serverConfig} from '../config';
import {
	chatStore,
	ChatEpisodeNotFoundError,
	ChatEpisodeUnavailableError,
	ChatIdempotencyConflictError,
	ChatProviderUnavailableError,
	ChatStateError,
	ChatTurnInProgressError,
} from '../services/chatStore';
import {openAiCredentialService} from '../services/openAiCredentialService';
import {parseChatQuestionRequest, parseIdempotencyKey} from '../validation';

interface ChatRouterDependencies {
	chats: Pick<typeof chatStore, 'assertEpisodeAvailable' | 'enqueue' | 'get' | 'listByRun' | 'retry'>;
	isTextProviderConfigured: () => boolean;
}

const sendEpisodeError = (error: unknown, res: Response): boolean => {
	if (error instanceof ChatEpisodeNotFoundError) {
		res.status(404).json({code: 'EPISODE_NOT_FOUND', error: 'Episode not found', correlationId: res.locals.correlationId});
		return true;
	}
	if (error instanceof ChatEpisodeUnavailableError) {
		res.status(409).json({code: 'EPISODE_NOT_COMPLETE', error: 'Follow-up chat requires a completed grounded episode', correlationId: res.locals.correlationId});
		return true;
	}
	if (error instanceof ChatProviderUnavailableError) {
		res.status(503).json({code: 'PROVIDER_NOT_CONFIGURED', error: error.message, correlationId: res.locals.correlationId});
		return true;
	}
	return false;
};

export const createChatRouter = (dependencies: ChatRouterDependencies = {
	chats: chatStore,
	isTextProviderConfigured: () => openAiCredentialService.providerSummary(serverConfig).text.status !== 'NOT CONFIGURED',
}) => {
	const router = Router();
	router.use('/briefing-runs/:runId/chat-turns', (_req, res, next) => {
		res.set('Cache-Control', 'no-store');
		next();
	});

	router.get('/briefing-runs/:runId/chat-turns', (req, res) => {
		try {
			dependencies.chats.assertEpisodeAvailable(req.params.runId);
			res.json(dependencies.chats.listByRun(req.params.runId));
		} catch (error) {
			if (sendEpisodeError(error, res)) return;
			throw error;
		}
	});

	router.post('/briefing-runs/:runId/chat-turns', (req, res) => {
		const parsed = parseChatQuestionRequest(req.body);
		if (parsed.ok === false) {
			res.status(400).json({code: 'INVALID_CHAT_REQUEST', error: parsed.error, correlationId: res.locals.correlationId});
			return;
		}
		const idempotency = parseIdempotencyKey(req.get('Idempotency-Key'));
		if (idempotency.ok === false || !idempotency.value) {
			res.status(400).json({
				code: 'INVALID_IDEMPOTENCY_KEY',
				error: idempotency.ok === false ? idempotency.error : 'Idempotency-Key is required',
				correlationId: res.locals.correlationId,
			});
			return;
		}

		try {
			const result = dependencies.chats.enqueue(
				req.params.runId,
				parsed.value.question,
				idempotency.value,
				dependencies.isTextProviderConfigured(),
			);
			res.status(result.created ? 202 : 200).json(result.turn);
		} catch (error) {
			if (sendEpisodeError(error, res)) return;
			if (error instanceof ChatIdempotencyConflictError) {
				res.status(409).json({code: 'IDEMPOTENCY_CONFLICT', error: error.message, correlationId: res.locals.correlationId});
				return;
			}
			if (error instanceof ChatTurnInProgressError) {
				res.status(409).json({code: 'CHAT_TURN_IN_PROGRESS', error: error.message, correlationId: res.locals.correlationId});
				return;
			}
			throw error;
		}
	});

	router.post('/briefing-runs/:runId/chat-turns/:turnId/retry', (req, res) => {
		const turn = dependencies.chats.get(req.params.turnId);
		if (!turn || turn.runId !== req.params.runId) {
			res.status(404).json({code: 'CHAT_TURN_NOT_FOUND', error: 'Chat turn not found', correlationId: res.locals.correlationId});
			return;
		}
		const idempotency = parseIdempotencyKey(req.get('Idempotency-Key'));
		if (idempotency.ok === false || !idempotency.value) {
			res.status(400).json({
				code: 'INVALID_IDEMPOTENCY_KEY',
				error: idempotency.ok === false ? idempotency.error : 'Idempotency-Key is required',
				correlationId: res.locals.correlationId,
			});
			return;
		}

		try {
			res.json(dependencies.chats.retry(turn.id, idempotency.value, dependencies.isTextProviderConfigured()));
		} catch (error) {
			if (sendEpisodeError(error, res)) return;
			if (error instanceof ChatStateError) {
				res.status(409).json({code: 'CHAT_NOT_RETRYABLE', error: 'This chat failure cannot be retried', correlationId: res.locals.correlationId});
				return;
			}
			throw error;
		}
	});

	return router;
};

export const chatRouter = createChatRouter();
