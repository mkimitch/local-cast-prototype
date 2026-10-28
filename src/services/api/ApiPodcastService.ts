import type {PodcastStatus} from '../../types';
import type {PodcastService} from './index';
import {apiRequest} from './httpClient';

type SubscriptionResponse = {subscriptionUrl: string};

export class ApiPodcastService implements PodcastService {
  getStatus(): Promise<PodcastStatus> {
    return apiRequest<PodcastStatus>('/podcast/status');
  }

  async copySubscriptionUrlToClipboard(): Promise<void> {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable');
    const response = await apiRequest<SubscriptionResponse>('/podcast/subscription-url', {method: 'POST'});
    try {
      await navigator.clipboard.writeText(response.subscriptionUrl);
    } finally {
      response.subscriptionUrl = '';
    }
  }
}
