import { WebClient } from '@slack/web-api';
import type { SlackAdapter } from '../types.js';

export class SlackService implements SlackAdapter {
  private client: WebClient;

  constructor(token: string) {
    this.client = new WebClient(token);
  }

  async post(channel: string, message: string): Promise<void> {
    await this.client.chat.postMessage({ channel, text: message });
  }
}
