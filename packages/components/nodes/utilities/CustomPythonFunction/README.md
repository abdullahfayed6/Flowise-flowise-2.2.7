# Custom Python Function Node

This README documents the current behavior of the `Custom Python Function` node and related server-side routing behavior used by `/node-custom-function`.

## What this node does

The node executes user-provided Python code in a temporary script and returns JSON-serializable output.

### Inputs

- `functionInputVariables` (optional, JSON): custom variables injected into the Python execution context.
- `functionName` (optional, string): display metadata (not required for execution).
- `pythonFunction` (code): Python function body that is wrapped into `custom_function()`.
- `pythonPath` (optional, string): Python executable path (`python` by default).
- `executionTimeout` (optional, number): max runtime in seconds (default: `60`).

### Available variables inside Python

- `input_text`: current node input string.
- `vars`: Flowise variables prepared from the runtime context.
- `flow`: flow/session metadata (`chatflowId`, `sessionId`, `chatId`, `input`).
- `custom_inputs`: dictionary of all custom input variables with original keys.
- Sanitized Python locals for custom input keys are also generated when possible.

## Recent reliability updates

1. **Timeout support**
   - A configurable `executionTimeout` was added.
   - Python subprocesses are killed when timeout is exceeded to avoid indefinitely hanging workflows.

2. **Safer custom variable handling**
   - Custom input keys are converted to safe Python variable names before local assignment.
   - Original keys remain accessible through `custom_inputs`.

3. **Empty function body guard**
   - If no function body is supplied, the node injects `pass` to avoid invalid Python syntax.

4. **Temp-file cleanup**
   - Temporary script files are cleaned up on both success and failure paths.

## Server routing behavior for `/node-custom-function`

When requests are sent through the custom-function API, server logic now attempts to route Python snippets to `customPythonFunction` when:

- `pythonFunction` is provided, or
- `language === 'python'`, or
- `javascriptFunction` appears to be Python code (heuristic detection).

The heuristic recognizes common Python patterns (e.g. `import`, `def`, `return`, list comprehensions, `range(...)`) and avoids explicit JavaScript syntax (`const/let/var`, `function`, `=>`).

This addresses cases like:

```python
return [i for i in range(1, 10000)]
```

which previously could be misrouted to the JavaScript executor and fail with `Unexpected token 'for'`.

## Limitations

This node is more robust now, but it cannot be guaranteed to work in all environments. Success still depends on:

- Python availability at `pythonPath`
- installed Python dependencies used by user code
- user code correctness/runtime behavior
- host OS/process restrictions

