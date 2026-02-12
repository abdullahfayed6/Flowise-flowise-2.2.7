 # CustomToolPython

This folder implements a Python-executing custom tool for Flowise. It provides a node that mirrors the existing JavaScript `CustomTool` but executes user-provided Python code in a child Python process, communicating via JSON on stdin/stdout.

Purpose

- Provide a safe integration point for user Python code inside chatflows (note: this implementation does not provide OS-level sandboxing; see Security section).

Files added/modified

- `core.ts` — Implements `DynamicStructuredPythonTool`. Creates a temporary Python script, sends a JSON payload via stdin, reads JSON result from stdout, enforces a timeout, and integrates with `CallbackManager` and Zod schema validation.
- `CustomToolPython.ts` — Node wrapper that loads Tool entries from the DB and returns a configured `DynamicStructuredPythonTool` instance for use in chatflows.
- `README.md` — (this file) documents how to write Python functions for the runner and runtime notes.

Environment variables

- `TOOL_PYTHON_PATH` — optional, path to the Python interpreter (defaults to `python`).
- `TOOL_PYTHON_TIMEOUT` — optional, timeout in milliseconds for Python execution (defaults to `10000`).

How it works

- Input validation: the node expects a Zod schema for the tool input (same as JS tool). Inputs are validated before execution.
- Payload: the runner builds a payload object with keys `input`, `vars`, and `flow` and sends it as JSON to the Python process via stdin.
- Python wrapper: user code is wrapped into a function named `__flowise_user_func(payload)` and executed. The returned value is printed as JSON on stdout.
- Return: stdout is parsed as JSON and returned to the caller. If parsing fails, raw string output is returned.
- Timeouts and cleanup: the Node side enforces a timeout (default 10000 ms), kills the child process on timeout, and removes temporary files.

How to author a Python custom tool

1. Write a function named `__flowise_user_func(payload)` where `payload` is a Python dict.
2. Use `payload.get('input')`, `payload.get('vars')`, and `payload.get('flow')` to access data injected by Flowise.
3. Return a JSON-serializable result (e.g., dict, list, string, number).

Minimal example

```python
def __flowise_user_func(payload):
        # payload['input'] contains the node input according to the Zod schema
        data = payload.get('input', {})
        # example: return a list of numbers
        return list(range(1, 21))
```

Additional resources

- Non-node file diffs/snippets: `SNIPPETS_NON_NODE_FILES.md` (contains before/after snippets for UI files edited: `ToolDialog.jsx` and `HowToUseFunctionDialog.jsx`).


Notes about the UI

- The Tools dialog and editor were updated to show "Python Function" and use the Python code editor mode. See `packages/ui/src/views/tools/ToolDialog.jsx` and `packages/ui/src/views/tools/HowToUseFunctionDialog.jsx` (these files were updated to reflect the Python runner and JSON-serializable return requirement).

Security & Limitations

- Executing arbitrary Python code is inherently risky. This implementation runs Python as a child process without OS-level sandboxing. A malicious or buggy script can access the filesystem, network, spawn processes, or consume resources.
- Recommended deployment options for untrusted code:
    - Run the Python runner in a dedicated container with resource limits (CPU, memory) and restricted network and filesystem access.
    - Use a separate execution service (microservice) that enforces quotas and isolation.
    - Restrict allowed Python packages to a curated set inside the runtime environment.

Transport and escaping

- The runner passes the entire payload as JSON to Python stdin to avoid shell-escaping issues.

Developer notes / build

- After editing the node, rebuild the `components` package and the `ui` package to pick up changes:

```bash
pnpm --filter ./packages/components run build
pnpm --filter ./packages/ui run build
```

Where to look

- Node core: `packages/components/nodes/tools/CustomToolPython/core.ts`
- Node wrapper: `packages/components/nodes/tools/CustomToolPython/CustomToolPython.ts`
- UI changes: `packages/ui/src/views/tools/ToolDialog.jsx`, `packages/ui/src/views/tools/HowToUseFunctionDialog.jsx`

Testing suggestions

- Create a simple tool in the Tools dashboard with a small Python function (like the Minimal example) and use it from a chatflow to verify payload and return semantics.
- Test timeout handling by adding an infinite loop in the Python function and ensuring Node-side timeout kills the child process.

Recent runtime changes (important)

- Preprocessing: user code now undergoes a simple transformation before execution:
    - `$name` is converted to `name` (regex replace) so JS-style `$` variable shorthand works in many cases.
    - Top-level `return ...` statements are rewritten to assign to `__flowise_return = ...` so users can write a top-level `return` instead of wrapping code in a function.
- Globals injection: input properties from the tool input (the `input` object) are injected as Python module-level globals when the property name is a valid Python identifier. For example, if your tool input schema includes `query`, then `query` will be available directly in user code.
- Execution semantics: the runner executes user code via `exec()` and then resolves the value in this order:
    1. If a callable `__flowise_user_func` exists, it is called with the `payload` and its return value is used.
    2. Else if `__flowise_return` is set (from a top-level `return`), that value is used.
    3. Else if a variable named `result` is defined at module scope, that is used.
    4. Otherwise `null` (JSON `null`) is returned.

Examples to paste in the UI (test cases)

1) Top-level `return` with `$` shorthand (minimal edit from JS):

```python
import requests
import urllib.parse

query_input = $query

API_KEY = "YOUR_API_KEY_HERE"

encoded_query = urllib.parse.quote(query_input)
url = f"https://www.googleapis.com/books/v1/volumes?q={encoded_query}&key={API_KEY}"

try:
        response = requests.get(url)
        response.raise_for_status()
        result = response.json()
except requests.exceptions.RequestException as error:
        result = {"error": error.response.json() if getattr(error, 'response', None) else str(error)}

return result
```

2) Explicit `payload` usage (recommended, safest):

```python
import requests
import urllib.parse

query_input = payload.get('input', {}).get('query', '')

API_KEY = "YOUR_API_KEY_HERE"

encoded_query = urllib.parse.quote(query_input)
url = f"https://www.googleapis.com/books/v1/volumes?q={encoded_query}&key={API_KEY}"

try:
        response = requests.get(url)
        response.raise_for_status()
        return response.json()
except requests.exceptions.RequestException as error:
        return {"error": error.response.json() if getattr(error, 'response', None) else str(error)}
```

Notes and caveats

- The `$` replacement is a simple regex; it can replace occurrences inside strings and comments — prefer `payload` access for robust code.
- Only injects input keys that are valid Python identifiers. If your property name contains dashes or spaces use `payload.get('input', {})['the-key']`.
- These features are intended to make authoring easier but reduce isolation; always treat user code as untrusted.

Next improvements

- Extract Python execution helpers into a shared utility to reuse across other nodes.
- Add integration tests under `packages/components/test` to validate run lifecycle, timeout, and error handling.
- Consider adding DB metadata for tools to indicate language (`javascript` | `python`) so UI can present the correct editor and help text.

Security & Limitations

- Executing arbitrary Python code is dangerous. This implementation runs the Python interpreter as a child process with no additional sandboxing. Consider running in containers, using OS-level restrictions, or a dedicated runner service for untrusted code.
- Third-party Python package imports are allowed only if those packages are installed in the interpreter used (`TOOL_PYTHON_PATH`). The code does not install packages automatically.

Next steps / suggestions

- Add tests under `tests/` to validate execution, timeout, and error handling.
- Optionally extract Python execution helpers into a shared utility to reuse across other nodes.
