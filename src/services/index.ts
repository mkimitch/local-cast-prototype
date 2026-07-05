export * from './api';
export * from './mock/MockAiProvider';

import {ApiBriefingService, ApiProviderService, ApiSourceService, getServiceMode} from './api';
import type {BriefingService, ProviderService, SourceService} from './api';
import {MockBriefingService, setProviderService} from './mock/MockBriefingService';
import {MockProviderService} from './mock/MockProviderService';
import {MockSourceService} from './mock/MockSourceService';

interface Services {
  sourceService: SourceService;
  providerService: ProviderService;
  briefingService: BriefingService;
}

const createMockServices = (): Services => {
  const mockProviderService = new MockProviderService();
  setProviderService(mockProviderService);

  return {
    sourceService: new MockSourceService(),
    providerService: mockProviderService,
    briefingService: new MockBriefingService(),
  };
};

const createApiServices = (): Services => ({
  sourceService: new ApiSourceService(),
  providerService: new ApiProviderService(),
  briefingService: new ApiBriefingService(),
});

const services = getServiceMode() === 'api' ? createApiServices() : createMockServices();

export const {sourceService, providerService, briefingService} = services;
