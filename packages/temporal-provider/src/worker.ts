import { Worker, NativeConnection } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as activities from './activities.js';

export interface StartWorkerOptions {
  address?: string;        // e.g. "localhost:7233"
  namespace?: string;      // default: "default"
  taskQueue?: string;      // default: "sua-agents"
}

export const DEFAULT_TASK_QUEUE = 'sua-agents';

/**
 * Starts the Temporal worker process. This runs on the host, not in Docker,
 * because agents need to spawn shell commands and access Claude CLI.
 */
export async function startWorker(options: StartWorkerOptions = {}): Promise<Worker> {
  const address = options.address ?? process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const namespace = options.namespace ?? 'default';
  const taskQueue = options.taskQueue ?? DEFAULT_TASK_QUEUE;

  const connection = await NativeConnection.connect({ address });

  const here = dirname(fileURLToPath(import.meta.url));
  const workflowsPath = resolve(here, 'workflows.js');

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath,
    activities,
  });

  return worker;
}
