import {Router, type NextFunction, type Request, type Response} from 'express';
import {serverConfig} from '../config';
import {openAiCredentialService, OpenAiCredentialOperationError, type OpenAiCredentialService} from '../services/openAiCredentialService';
import {settingsStore} from '../services/settingsStore';
import {parseOpenAiCredentialBody, parseSettingsBody} from '../validation';

type SettingsRouterDependencies = {
	store: typeof settingsStore;
	credentialService: Pick<OpenAiCredentialService, 'replace' | 'testConnection'>;
};

const noStore = (_req: Request, res: Response, next: NextFunction): void => {
	res.setHeader('Cache-Control', 'no-store');
	next();
};

export const createSettingsRouter = (dependencies: SettingsRouterDependencies = {
	store: settingsStore,
	credentialService: openAiCredentialService,
}): Router => {
	const router = Router();
	router.use('/settings', noStore);

	router.get('/settings', (_req, res) => {
		res.json(dependencies.store.getSettings());
	});

	router.put('/settings', (req, res) => {
		const parsed = parseSettingsBody(req.body);
		if (parsed.ok === false) {
			res.status(400).json({error: parsed.error});
			return;
		}
		res.json(dependencies.store.saveSettings(parsed.value));
	});

	router.put('/settings/provider-credentials/openai', (req, res) => {
		const parsed = parseOpenAiCredentialBody(req.body);
		if (parsed.ok === false) {
			res.status(400).json({code: 'INVALID_OPENAI_CREDENTIAL', error: parsed.error});
			return;
		}
		try {
			const credential = dependencies.credentialService.replace(serverConfig, parsed.value.apiKey);
			res.json({credential});
		} catch (error) {
			const failure = error instanceof OpenAiCredentialOperationError
				? error
				: new OpenAiCredentialOperationError('OPENAI_CREDENTIAL_STORAGE_FAILED', 'LocalCast could not store the OpenAI API key safely.', 500);
			res.status(failure.httpStatus).json({code: failure.code, error: failure.message});
		}
	});

	router.post('/settings/provider-credentials/openai/test', async (_req, res) => {
		try {
			res.json(await dependencies.credentialService.testConnection(serverConfig));
		} catch (error) {
			const failure = error instanceof OpenAiCredentialOperationError
				? error
				: new OpenAiCredentialOperationError('OPENAI_PROVIDER_UNAVAILABLE', 'OpenAI could not be reached.', 503);
			res.status(failure.httpStatus).json({code: failure.code, error: failure.message});
		}
	});

	return router;
};

export const settingsRouter = createSettingsRouter();
