import sys
import json
import importlib.util
import os
import platform


def send_message(payload):
    """Send a JSON line to the parent process.

    On Unix-like systems, write to the file descriptor provided via env
    NODE_CHANNEL_FD. On Windows, write to stdout.
    """
    bytes_message = (json.dumps(payload) + "\n").encode("utf-8")

    if platform.system() == "Windows":
        # On Windows, write to stdout
        sys.stdout.buffer.write(bytes_message)
        sys.stdout.buffer.flush()
    else:
        # On Unix systems, use the provided file descriptor
        fd = int(os.environ["NODE_CHANNEL_FD"])  # expected to be set by parent
        os.write(fd, bytes_message)


async def run_python_module(file_path: str) -> None:
    try:
        module_dir = os.path.dirname(os.path.abspath(file_path))

        if module_dir not in sys.path:
            sys.path.insert(0, module_dir)

        spec = importlib.util.spec_from_file_location(
            os.path.splitext(os.path.basename(file_path))[0], file_path
        )
        if spec is None or spec.loader is None:
            raise ImportError(f"Could not load module from {file_path}")

        module = importlib.util.module_from_spec(spec)
        # Set a basic package name to allow relative imports from same dir
        module.__package__ = os.path.basename(module_dir)
        spec.loader.exec_module(module)

        if not hasattr(module, "config"):
            raise AttributeError(f"No 'config' found in module {file_path}")

        cfg = getattr(module, "config")
        # Remove keys that are not serializable or not needed
        if isinstance(cfg, dict) and "middleware" in cfg:
            del cfg["middleware"]

        send_message(cfg)
    except Exception as error:
        print("Error running Python module:", str(error), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(1)
    file_path = sys.argv[1]
    import asyncio

    asyncio.run(run_python_module(file_path))
