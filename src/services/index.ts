export * from './api';

import {ApiBriefingService, ApiProviderService, ApiSourceService} from './api';
import type {BriefingService, ProviderService, SourceService} from './api';

interface Services {
  sourceService: SourceService;
  providerService: ProviderService;
  briefingService: BriefingService;
}

const createApiServices = (): Services => ({
  sourceService: new ApiSourceService(),
  providerService: new ApiProviderService(),
  briefingService: new ApiBriefingService(),
});

const services = createApiServices();

export const {sourceService, providerService, briefingService} = services;
