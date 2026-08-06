export * from './api';

import {ApiBriefingService, ApiProviderService, ApiSourceService, ApiStationService} from './api';
import type {BriefingService, ProviderService, SourceService, StationService} from './api';

interface Services {
  sourceService: SourceService;
  providerService: ProviderService;
  briefingService: BriefingService;
  stationService: StationService;
}

const createApiServices = (): Services => ({
  sourceService: new ApiSourceService(),
  providerService: new ApiProviderService(),
  briefingService: new ApiBriefingService(),
  stationService: new ApiStationService(),
});

const services = createApiServices();

export const {sourceService, providerService, briefingService, stationService} = services;
