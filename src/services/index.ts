export * from './api';
export * from './mock/MockAiProvider';

import { MockSourceService } from './mock/MockSourceService';
import { MockBriefingService, setProviderService } from './mock/MockBriefingService';
import { MockProviderService } from './mock/MockProviderService';

export const sourceService = new MockSourceService();
export const providerService = new MockProviderService();
setProviderService(providerService);
export const briefingService = new MockBriefingService();
