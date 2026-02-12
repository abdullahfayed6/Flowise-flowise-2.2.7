import { z } from 'zod'
import { RunnableConfig } from '@langchain/core/runnables'
import { StructuredTool, ToolParams } from '@langchain/core/tools'
import { CallbackManagerForToolRun, Callbacks, CallbackManager, parseCallbackConfigArg } from '@langchain/core/callbacks/manager'
import { prepareSandboxVars } from '../../../src/utils'
import { ICommonObject } from '../../../src/Interface'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { spawn } from 'child_process'

class ToolInputParsingException extends Error {
    output?: string

    constructor(message: string, output?: string) {
        super(message)
        this.output = output
    }
}

export interface BaseDynamicToolInput extends ToolParams {
    name: string
    description: string
    code: string
    returnDirect?: boolean
}

export interface DynamicStructuredToolInput<
    T extends z.ZodObject<any, any, any, any> = z.ZodObject<any, any, any, any>
> extends BaseDynamicToolInput {
    func?: (input: z.infer<T>, runManager?: CallbackManagerForToolRun) => Promise<string>
    schema: T
}

export class DynamicStructuredPythonTool<
    T extends z.ZodObject<any, any, any, any> = z.ZodObject<any, any, any, any>
> extends StructuredTool {
    name: string

    description: string

    code: string

    func: DynamicStructuredToolInput['func']

    // @ts-ignore
    schema: T
    private variables: any[]
    private flowObj: any

    constructor(fields: DynamicStructuredToolInput<T>) {
        super(fields)
        this.name = fields.name
        this.description = fields.description
        this.code = fields.code
        this.func = fields.func
        this.returnDirect = fields.returnDirect ?? this.returnDirect
        this.schema = fields.schema
    }

    async call(
        arg: z.output<T>,
        configArg?: RunnableConfig | Callbacks,
        tags?: string[],
        flowConfig?: { sessionId?: string; chatId?: string; input?: string; state?: ICommonObject }
    ): Promise<string> {
        const config = parseCallbackConfigArg(configArg)
        if (config.runName === undefined) {
            config.runName = this.name
        }
        let parsed
        try {
            parsed = await this.schema.parseAsync(arg)
        } catch (e) {
            throw new ToolInputParsingException(`Received tool input did not match expected schema`, JSON.stringify(arg))
        }
        const callbackManager_ = await CallbackManager.configure(
            config.callbacks,
            this.callbacks,
            config.tags || tags,
            this.tags,
            config.metadata,
            this.metadata,
            { verbose: this.verbose }
        )
        const runManager = await callbackManager_?.handleToolStart(
            this.toJSON(),
            typeof parsed === 'string' ? parsed : JSON.stringify(parsed),
            undefined,
            undefined,
            undefined,
            undefined,
            config.runName
        )
        let result
        try {
            result = await this._call(parsed, runManager, flowConfig)
        } catch (e) {
            await runManager?.handleToolError(e)
            throw e
        }
        if (result && typeof result !== 'string') {
            result = JSON.stringify(result)
        }
        await runManager?.handleToolEnd(result)
        return result
    }

    // Executes Python code by creating a temporary script and invoking the Python interpreter.
    // Communication is done via JSON on stdin/stdout.
    // @ts-ignore
    protected async _call(
        arg: z.output<T>,
        _?: CallbackManagerForToolRun,
        flowConfig?: { sessionId?: string; chatId?: string; input?: string; state?: ICommonObject }
    ): Promise<string> {
        const payload = {
            input: arg,
            vars: prepareSandboxVars(this.variables),
            flow: this.flowObj ? { ...this.flowObj, ...flowConfig } : { ...flowConfig }
        }

        const tempDir = os.tmpdir()
        const scriptName = `flowise_python_${Date.now()}_${Math.random().toString(36).slice(2)}.py`
        const scriptPath = path.join(tempDir, scriptName)

        // Wrap user code into a function so we can call it with the payload.
        const indent = (s: string) => s.split('\n').map(l => `    ${l}`).join('\n')

        let userCode = this.code || ''

        // Allow users who write $var to access input properties: convert $var -> var
        userCode = userCode.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, '$1')

        // Convert top-level `return ...` into assignment to capture variable so users can write JS-style
        // top-level return statements and still get a value back.
        userCode = userCode.replace(/^\s*return\b/mg, '__flowise_return =')

        // Build Python script: inject input properties as module-level globals so they are accessible
        // inside the user's code by name (e.g., `query`). Execute the user's code with exec, then
        // determine the result from several possible locations: a defined function, a captured
        // __flowise_return, or a `result` variable.
        const pythonScript = `import sys, json, traceback\n\npayload = json.load(sys.stdin)\n_input = payload.get('input', {})\nvars = payload.get('vars', {})\nflow = payload.get('flow', {})\n\n# inject input properties as globals for easier access inside user code\nfor _k, _v in _input.items():\n    try:\n        if isinstance(_k, str) and _k.isidentifier():\n            globals()[_k] = _v\n    except Exception:\n        pass\n\n# User code starts here\nuser_code = '''\n${userCode.replace(/'''/g, "\\'\\'\\'")}\n'''\n\ntry:\n    exec(user_code, globals())\nexcept Exception:\n    traceback.print_exc(file=sys.stderr)\n    sys.exit(1)\n\n# Determine result:\nif '__flowise_user_func' in globals() and callable(globals()['__flowise_user_func']):\n    try:\n        result = globals()['__flowise_user_func'](payload)\n    except Exception:\n        traceback.print_exc(file=sys.stderr)\n        sys.exit(1)\nelif '__flowise_return' in globals():\n    result = globals().get('__flowise_return')\nelif 'result' in globals():\n    result = globals().get('result')\nelse:\n    result = None\n\nprint(json.dumps(result, default=str))\n`

        fs.writeFileSync(scriptPath, pythonScript, { encoding: 'utf8' })

        const pythonPath = process.env.TOOL_PYTHON_PATH || 'python'
        const timeoutMs = Number(process.env.TOOL_PYTHON_TIMEOUT || '10000')

        const child = spawn(pythonPath, [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] })

        let stdout = ''
        let stderr = ''
        let timedOut = false

        const timeoutHandle = setTimeout(() => {
            timedOut = true
            try {
                if (process.platform === 'win32') {
                    child.kill()
                } else {
                    child.kill('SIGKILL')
                }
            } catch (e) {
                try { child.kill() } catch (e) {}
            }
        }, timeoutMs)

        child.stdout.on('data', (d) => { stdout += d.toString() })
        child.stderr.on('data', (d) => { stderr += d.toString() })

        // send payload and close stdin
        try {
            child.stdin.write(JSON.stringify(payload))
            child.stdin.end()
        } catch (e) {
            // ignore
        }

        const response = new Promise<string>((resolve, reject) => {
            child.on('error', (err) => {
                clearTimeout(timeoutHandle)
                try { fs.unlinkSync(scriptPath) } catch (e) {}
                reject(err)
            })
            child.on('close', (code) => {
                clearTimeout(timeoutHandle)
                try { fs.unlinkSync(scriptPath) } catch (e) {}
                if (timedOut) return reject(new Error(`Python script timed out after ${timeoutMs} ms`))
                if (code !== 0) {
                    const err = new Error(`Python script exited with code ${code}: ${stderr}`)
                    return reject(err)
                }
                return resolve(stdout.trim())
            })
        })

        const out = await response
        try {
            return JSON.parse(out)
        } catch (e) {
            return out
        }
    }

    setVariables(variables: any[]) {
        this.variables = variables
    }

    setFlowObject(flow: any) {
        this.flowObj = flow
    }
}

export default DynamicStructuredPythonTool
