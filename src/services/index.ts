export * from './api';

import {ApiBriefingService, ApiPodcastService, ApiProviderService, ApiSourceService, ApiStationService} from './api';
import type {BriefingService, PodcastService, ProviderService, SourceService, StationService} from './api';

interface Services {
  sourceService: SourceService;
  providerService: ProviderService;
  briefingService: BriefingService;
  stationService: StationService;
  podcastService: PodcastService;
}

const createApiServices = (): Services => ({
  sourceService: new ApiSourceService(),
  providerService: new ApiProviderService(),
  briefingService: new ApiBriefingService(),
  stationService: new ApiStationService(),
  podcastService: new ApiPodcastService(),
});

const services = createApiServices();

export const {sourceService, providerService, briefingService, stationService, podcastService} = services;
