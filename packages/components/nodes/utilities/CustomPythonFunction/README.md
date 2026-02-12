Documentation of code edits
=======================================

Notes (kept + updated)
- This file tracks **what changed**, **why**, and the exact **Snippets / Diffs** used for the latest updates.
- It is intentionally focused on implementation/routing behavior for `Custom Python Function` and `/node-custom-function`.
- Runtime still depends on environment conditions (Python path, dependencies, user code), so this is not a universal guarantee of success.

Summary of latest updates
-------------------------

1) Node runtime hardening
- File: `packages/components/nodes/utilities/CustomPythonFunction/CustomPythonFunction.ts`
- Added `executionTimeout` input with default `60` seconds.
- Added timeout enforcement for spawned Python process (kill on timeout + descriptive error).
- Added safe mapping for custom input keys to Python-local variable names.
- Added `custom_inputs` dict inside Python runtime for original input keys.
- Added fallback body `pass` when `pythonFunction` is empty.

2) Server routing fix for Python snippets
- File: `packages/server/src/services/nodes/index.ts`
- Improved Python detection for requests sent via `javascriptFunction`.
- Added `language === 'python'` as an explicit routing signal.
- Expanded heuristic to detect Python-only patterns such as return-only snippets and list comprehensions (e.g. `return [i for i in range(...)]`).
- Added JS-syntax guard to avoid misrouting obvious JavaScript.

3) README refresh
- File: `packages/components/nodes/utilities/CustomPythonFunction/README.md`
- Rewritten to reflect current behavior, inputs, runtime variables, routing rules, and limitations.
- Added this `Snippets / Diffs` section back (requested), with updated patches.

Why this was needed
-------------------

A payload like below could be interpreted as JavaScript when submitted via `javascriptFunction`, causing:
`SyntaxError: Unexpected token 'for'`.

```python
return [i for i in range(1, 10000)]
```

The routing heuristic now treats this as Python and sends it to `customPythonFunction`.

Snippets / Diffs (latest)
-------------------------

Below are the important patch snippets for the current implementation.

- File: `packages/components/nodes/utilities/CustomPythonFunction/CustomPythonFunction.ts`
```diff
*** Update File: packages/components/nodes/utilities/CustomPythonFunction/CustomPythonFunction.ts
@@
+const DEFAULT_TIMEOUT_SECONDS = 60
+
+const toSafePythonVariableName = (rawKey: string, index: number): string => {
+    const normalized = rawKey.replace(/[^A-Za-z0-9_]/g, '_')
+    const prefixed = /^[A-Za-z_]/.test(normalized) ? normalized : `_${normalized}`
+    return prefixed.length > 0 ? prefixed : `custom_input_${index}`
+}
@@
+            {
+                label: 'Execution Timeout (seconds)',
+                name: 'executionTimeout',
+                type: 'number',
+                optional: true,
+                default: DEFAULT_TIMEOUT_SECONDS,
+                description: `Maximum script runtime in seconds (default: ${DEFAULT_TIMEOUT_SECONDS}).`
+            }
@@
+        const executionTimeout = Number(nodeData.inputs?.executionTimeout ?? DEFAULT_TIMEOUT_SECONDS)
+        const timeoutMs = Number.isFinite(executionTimeout) && executionTimeout > 0 ? executionTimeout * 1000 : DEFAULT_TIMEOUT_SECONDS * 1000
@@
+        const customInputAssignments = Object.keys(inputVars)
+            .map((key, index) => `${toSafePythonVariableName(key, index)} = input_data.get(${JSON.stringify(key)}, None)`)
+            .join('\n')
@@
+custom_inputs = {k: v for k, v in input_data.items() if k not in ('input_text', 'vars', 'flow')}
@@
-${pythonFunction
+${(pythonFunction || 'pass')
@@
-            const result = await this.executePythonScript(pythonPath, scriptPath)
+            const result = await this.executePythonScript(pythonPath, scriptPath, timeoutMs)
@@
-    private executePythonScript(pythonPath: string, scriptPath: string): Promise<string> {
+    private executePythonScript(pythonPath: string, scriptPath: string, timeoutMs: number): Promise<string> {
@@
+            let timedOut = false
+            const timeoutHandle = setTimeout(() => {
+                timedOut = true
+                pythonProcess.kill('SIGKILL')
+            }, timeoutMs)
@@
+                clearTimeout(timeoutHandle)
+                if (timedOut) {
+                    reject(new Error(`Python script execution timed out after ${Math.floor(timeoutMs / 1000)} seconds`))
+                    return
+                }
@@
+                clearTimeout(timeoutHandle)
```

- File: `packages/server/src/services/nodes/index.ts`
```diff
*** Update File: packages/server/src/services/nodes/index.ts
@@
-        // Heuristic: consider Python if `pythonFunction` provided or if `javascriptFunction` looks like Python source
-        const looksLikePython = (code?: string) => {
-            if (!code || typeof code !== 'string') return false
-            return /\bdef\b|\bimport\b|\bprint\(/.test(code)
-        }
+        const detectPythonCode = (code?: string) => {
+            if (!code || typeof code !== 'string') return false
+
+            const normalizedCode = code.trim()
+            if (!normalizedCode) return false
+
+            const hasExplicitJavascriptSyntax =
+                /(^|\n)\s*(const|let|var)\s+/.test(normalizedCode) ||
+                /(^|\n)\s*function\s*\(/.test(normalizedCode) ||
+                /=>/.test(normalizedCode)
+
+            if (hasExplicitJavascriptSyntax) return false
+
+            const pythonSignals =
+                /(^|\n)\s*import\s+[a-zA-Z0-9_.]+/.test(normalizedCode) ||
+                /(^|\n)\s*from\s+[a-zA-Z0-9_.]+\s+import\s+/.test(normalizedCode) ||
+                /(^|\n)\s*def\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(/.test(normalizedCode) ||
+                /(^|\n)\s*return\s+/.test(normalizedCode) ||
+                /\[[^\]]+\s+for\s+[^\]]+\s+in\s+[^\]]+\]/.test(normalizedCode) ||
+                /\brange\s*\(/.test(normalizedCode)
+
+            return pythonSignals
+        }
@@
-        const prefersPython = Boolean(body?.pythonFunction) || looksLikePython(body?.javascriptFunction)
+        const prefersPython = Boolean(body?.pythonFunction) || body?.language === 'python' || detectPythonCode(body?.javascriptFunction)
```

Operational notes
-----------------

- If Python snippets are still routed to JS in a client integration, send `language: 'python'` explicitly.
- If execution fails with process start errors, verify `pythonPath` and environment PATH.
- If execution times out, increase `executionTimeout` carefully.
