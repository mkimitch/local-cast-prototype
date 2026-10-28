import {serverConfig} from '../config';
import {OpenAiCredentialStore} from './openAiCredentialStore';

export const openAiCredentialStore = new OpenAiCredentialStore(serverConfig.credentialDirectory);
