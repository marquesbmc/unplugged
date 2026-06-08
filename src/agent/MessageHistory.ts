import { ChatMessage } from '../llm/LlamaEngine';

const MAX_HISTORY = 30;

export class MessageHistory {
  private _messages: ChatMessage[] = [];

  add(msg: ChatMessage): void {
    this._messages.push(msg);
    while (this._messages.length > MAX_HISTORY) {
      this._messages.shift();
    }
  }

  getAll(): ChatMessage[] {
    return [...this._messages];
  }

  clear(): void {
    this._messages = [];
  }

  get length(): number {
    return this._messages.length;
  }
}
