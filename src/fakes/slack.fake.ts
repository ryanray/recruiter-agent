import type { SlackAdapter } from '../types.js';

export class FakeSlackAdapter implements SlackAdapter {
  messages: { channel: string; message: string }[] = [];

  async post(channel: string, message: string): Promise<void> {
    this.messages.push({ channel, message });
  }
}
