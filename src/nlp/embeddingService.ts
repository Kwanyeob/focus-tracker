export interface EmbeddingService {
  init(): Promise<void>;
  embed(text: string): Promise<number[]>;
  shutdown(): Promise<void>;
}
