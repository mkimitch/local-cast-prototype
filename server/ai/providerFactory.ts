import type {ServerConfig} from '../config';
import {serverConfig} from '../config';
import type {AiProvider} from './types';

export class ProviderNotConfiguredError extends Error {
	constructor() {
		super('A supported server-side text provider is not configured');
		this.name = 'ProviderNotConfiguredError';
	}
}

export const createAiProvider = (_config: ServerConfig = serverConfig): AiProvider => {
	throw new ProviderNotConfiguredError();
};
