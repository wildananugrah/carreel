export interface IJobQueue {
  enqueue(queueName: string, data: unknown): Promise<string | null>;
}
