import { defineEventHandler} from "h3"
import { Queue } from "bullmq"
import { createBullBoard } from "@bull-board/api"
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter"
import { H3Adapter } from "@bull-board/h3"
import { useRuntimeConfig } from "#imports"
import worker from "#worker"
import { resolvePath } from "mlly"
import { dirname } from "pathe"

const serverAdapter = new H3Adapter();
serverAdapter.setBasePath("/_queue");

export default defineEventHandler(async (event) => {

  const uiPath = dirname(
    await resolvePath("@bull-board/ui/package.json", {
      url: import.meta.url,
    })
  );

  const { redis } = useRuntimeConfig().queue

  await createBullBoard({
    queues: worker.map((worker) => {
      const queue = new Queue(worker.id, {
        connection: { 
          ...redis
        }
      })
      return new BullMQAdapter(queue)
    }),
    serverAdapter,
    options: {
      uiBasePath: `${uiPath}`,
      uiConfig: {
        boardTitle: "Queue Manager",
      },
    },
  });

  const uiRouter = await serverAdapter.registerHandlers();

  return await uiRouter.handler(event);
});