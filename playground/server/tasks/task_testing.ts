// implement wait function that can be used to delay task execution
function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default defineTask({
  meta: {
    name: "task:testing",
    description: "Run testing tasks",
    runtype: "queue"
  },
  async run({ payload, context }) {
    console.log("Running testing task...");
    await wait(5000);
    console.log("Testing task completed.");
    return { result: "Success" };
  },
});
