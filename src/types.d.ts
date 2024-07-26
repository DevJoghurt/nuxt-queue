import type { 
    WorkerOptions as BullmqWorkerOptions, 
    QueueOptions as BullmqQueueOptions } from "bullmq"

export type WorkerOptions =  Omit<BullmqWorkerOptions, "connection" | "useWorkerThreads">

export type WorkerConfig = Record<string, WorkerOptions>

export type RegisteredWorker = {
    id: string;
    name: string;
    script: string;
    options: WorkerOptions;
}

type QueueOptions = {
    // Queue runtime type, currently only pm2 is supported
    runtime: 'pm2';
    // if the worker runs local or remote
    remote: boolean;
    options?: BullmqQueueOptions;
  }
  
  
  export interface ModuleOptions {
    dir: string;
    runtimeDir: string;
    redis: {
        host: string;
        port: number;
    };
    queues?: Record<string, QueueOptions>;
}