# server/queues/hello.py

# Required: a top-level `config` dict (read by the module)
config = {
    "queue": "hello",  # optional; defaults to filename ("hello") if omitted
    "flow": {
        "name": ["welcome-flow"],
        "role": "entry",          # 'entry' or 'step'
        "step": "hello",
        "emits": ["hello.done"] # optional
    },
}

# Optional: your worker logic (runner hookup is a later step)
# Keep this here for parity with TS workers.
def run(payload, ctx=None):
    print(f"Processing hello with payload={payload}")
    return {"status": "ok"}