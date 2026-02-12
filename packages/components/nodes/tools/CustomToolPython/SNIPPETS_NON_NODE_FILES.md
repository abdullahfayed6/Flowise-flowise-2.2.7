Snippets / Diffs (non-node files)

Below are the before/after snippets for the non-node files I edited (UI). These exclude the node files (`core.ts` and `CustomToolPython.ts`).

1) packages/ui/src/views/tools/ToolDialog.jsx

- Example function updated (JS -> Python)

Before (JS example):
```diff
const exampleAPIFunc = `/*
* You can use any libraries imported in Flowise
* You can use properties specified in Input Schema as variables. Ex: Property = userid, Variable = $userid
* You can get default flow config: $flow.sessionId, $flow.chatId, $flow.chatflowId, $flow.input, $flow.state
* You can get custom variables: $vars.<variable-name>
* Must return a string value at the end of function
*/

const fetch = require('node-fetch');
... (JS async code)
`
```

After (Python example):
```diff
const exampleAPIFunc = `# Example Python function for Flowise custom tool
# You can use libraries installed in the Python runtime.
# The runner calls a function named __flowise_user_func(payload) with a single payload dict.
# payload contains: payload['input'], payload['vars'], payload['flow']

def __flowise_user_func(payload):
    input_data = payload.get('input', {})
    vars = payload.get('vars', {})
    flow = payload.get('flow', {})

    # Example: return a list of numbers
    return list(range(1, 20))
`
```

- Label and tooltip updated

Before:
```diff
<Typography variant='overline'>Javascript Function</Typography>
<TooltipWithParser title='Function to execute when tool is being used. You can use properties specified in Input Schema as variables. For example, if the property is <code>userid</code>, you can use as <code>$userid</code>. Return value must be a string. You can also override the code from API by following this <a target="_blank" href="https://docs.flowiseai.com/tools/custom-tool#override-function-from-api">guide</a>' />
```

After:
```diff
<Typography variant='overline'>Python Function</Typography>
<TooltipWithParser title='Function to execute when tool is being used. You can use properties specified in Input Schema as variables. For example, if the property is <code>userid</code>, you can use as <code>$userid</code>. The runner calls a function named <code>__flowise_user_func(payload)</code>. The function should return a JSON-serializable value. You can also override the code from API by following this <a target="_blank" href="https://docs.flowiseai.com/tools/custom-tool#override-function-from-api">guide</a>' />
```

- Editor language changed

Before:
```diff
<CodeEditor
    ...
    lang={'js'}
    onValueChange={(code) => setToolFunc(code)}
/>
```

After:
```diff
<CodeEditor
    ...
    lang={'python'}
    onValueChange={(code) => setToolFunc(code)}
/>
```

2) packages/ui/src/views/tools/HowToUseFunctionDialog.jsx

Before:
```diff
<li style={{ marginTop: 10 }}>Must return a string value at the end of function</li>
```

After:
```diff
<li style={{ marginTop: 10 }}>Return value should be JSON-serializable (object, array, string, number, etc.)</li>
```

If you prefer, I can also produce git-style unified diffs for these files or include the node-file diffs as well. Let me know which format you prefer.

Test snippets to paste in the Tools editor

1) Short form (uses `$query` or injected `query` global and top-level `return`):

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

2) Explicit form (recommended):

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
