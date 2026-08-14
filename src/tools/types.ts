import type { CanvasClient } from '../canvas/client.js';
import type { TextResult } from '../format/text.js';

export type Handler<T> = (input: T) => Promise<TextResult>;

export interface ToolDependencies {
  readonly client: CanvasClient;
  readonly timezone: string;
  readonly now: () => Date;
}
