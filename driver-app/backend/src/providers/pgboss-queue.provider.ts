import type { PgBoss } from "pg-boss";
import type { IJobQueue } from "../interfaces/providers/job-queue.provider.interface";

export class PgBossQueueProvider implements IJobQueue {
  constructor(private boss: PgBoss) {}

  async enqueue(queueName: string, data: unknown): Promise<string | null> {
    return this.boss.send(queueName, data as object);
  }
}
