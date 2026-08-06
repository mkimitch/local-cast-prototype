import {Router} from 'express';
import type {BriefingRun} from '../../src/types';
import {serverConfig} from '../config';
import {generationJobStore} from '../jobs/index';
import {IdempotencyConflictError, JobStateError} from '../jobs/generationJobStore';
import {briefingStore} from '../services/briefingStore';
import {providerCheckStore} from '../services/providerCheckStore';
import {parseBriefingRunRequest, parseIdempotencyKey} from '../validation';

export const briefingRunsRouter = Router();

const withJob = (run: BriefingRun): BriefingRun => {
	const job = generationJobStore.getByRunId(run.id);
	if (!job) return run;

	return {
		...run,
		job: {
			id: job.id,
			phase: job.phase,
			attemptCount: job.attemptCount,
			errorCode: job.errorCode,
			errorMessage: job.errorMessage,
			failedPhase: job.failedPhase,
			retryable: job.retryable,
		},
	};
};

briefingRunsRouter.get('/briefing-runs', (_req, res) => {
	res.json(briefingStore.listRuns().map(withJob));
});

briefingRunsRouter.post('/briefing-runs', (req, res) => {
	const providerStatus = providerCheckStore.summary(serverConfig);
	if (!providerStatus.generationEnabled) {
		res.status(503).json({code: 'PROVIDER_NOT_CONFIGURED', error: 'Text and speech providers are not configured'});
		return;
	}

	const parsed = parseBriefingRunRequest(req.body);
	if (parsed.ok === false) {
		res.status(400).json({error: parsed.error});
		return;
	}

	const idempotency = parseIdempotencyKey(req.get('Idempotency-Key'));
	if (idempotency.ok === false) {
		res.status(400).json({error: idempotency.error});
		return;
	}

	try {
		const result = generationJobStore.enqueueStation(parsed.value.stationId, parsed.value.mode, idempotency.value);
		const run = briefingStore.getRun(result.job.runId);
		if (!run) throw new Error('Queued run could not be loaded');
		res.status(result.created ? 201 : 200).json(withJob(run));
	} catch (error) {
		if (error instanceof IdempotencyConflictError) {
			res.status(409).json({code: 'IDEMPOTENCY_CONFLICT', error: error.message});
			return;
		}
		if (error instanceof JobStateError) {
			res.status(400).json({code: 'INVALID_GENERATION_REQUEST', error: error.message});
			return;
		}
		throw error;
	}
});

briefingRunsRouter.get('/briefing-runs/:id', (req, res) => {
	const run = briefingStore.getRun(req.params.id);
	if (!run) {
		res.status(404).json({error: 'Briefing run not found'});
		return;
	}

	res.json(withJob(run));
});
