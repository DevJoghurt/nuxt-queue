import type { WorkerOptions as BullmqWorkerOptions } from "bullmq"

export type WorkerOptions =  Omit<BullmqWorkerOptions, "connection" | "useWorkerThreads">

export type WorkerConfig = Record<string, WorkerOptions>

export type RegisteredWorker = {
    id: string;
    name: string;
    script: string;
    options: WorkerOptions;
}