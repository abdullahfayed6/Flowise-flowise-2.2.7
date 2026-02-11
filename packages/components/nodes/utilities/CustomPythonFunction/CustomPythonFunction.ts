import { flatten } from 'lodash'
import { type StructuredTool } from '@langchain/core/tools'
import { DataSource } from 'typeorm'
import { getVars, handleEscapeCharacters, prepareSandboxVars } from '../../../src/utils'
import { ICommonObject, IDatabaseEntity, INode, INodeData, INodeOutputsValue, INodeParams } from '../../../src/Interface'
import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

class CustomPythonFunction_Utilities implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    tags: string[]
    baseClasses: string[]
    inputs: INodeParams[]
    outputs: INodeOutputsValue[]

    constructor() {
        this.label = 'Custom Python Function'
        this.name = 'customPythonFunction'
        this.version = 1.0
        this.type = 'CustomPythonFunction'
        this.icon = 'custompythonfunction.svg'
        this.category = 'Utilities'
        this.description = `Execute custom Python function`
        this.baseClasses = [this.type, 'Utilities']
        this.tags = ['Utilities']
        this.inputs = [
            {
                label: 'Input Variables',
                name: 'functionInputVariables',
                description: 'Input variables can be used in the function as variables. For example: var1, var2',
                type: 'json',
                optional: true,
                acceptVariable: true,
                list: true
            },
            {
                label: 'Function Name',
                name: 'functionName',
                type: 'string',
                optional: true,
                placeholder: 'My Python Function'
            },
            {
                label: 'Python Function',
                name: 'pythonFunction',
                type: 'code',
                language: 'python',
                description: 'Python code to execute. Variables are available as: input_text, vars, flow, and any custom input variables.'
            },
            {
                label: 'Python Path',
                name: 'pythonPath',
                type: 'string',
                optional: true,
                placeholder: 'python',
                description: 'Path to Python executable (default: python). Use "python3" or full path if needed.'
            }
        ]
        this.outputs = [
            {
                label: 'Output',
                name: 'output',
                baseClasses: ['string', 'number', 'boolean', 'json', 'array']
            },
            {
                label: 'Ending Node',
                name: 'EndingNode',
                baseClasses: [this.type]
            }
        ]
    }

    async init(nodeData: INodeData, input: string, options: ICommonObject): Promise<any> {
        const isEndingNode = nodeData?.outputs?.output === 'EndingNode'
        if (isEndingNode && !options.isRun) return

        const pythonFunction = nodeData.inputs?.pythonFunction as string
        const functionInputVariablesRaw = nodeData.inputs?.functionInputVariables
        const pythonPath = (nodeData.inputs?.pythonPath as string) || 'python'
        const appDataSource = options.appDataSource as DataSource
        const databaseEntities = options.databaseEntities as IDatabaseEntity

        const variables = await getVars(appDataSource, databaseEntities, nodeData)
        const flow = {
            chatflowId: options.chatflowid,
            sessionId: options.sessionId,
            chatId: options.chatId,
            input
        }

        let inputVars: ICommonObject = {}
        if (functionInputVariablesRaw) {
            try {
                inputVars =
                    typeof functionInputVariablesRaw === 'object' ? functionInputVariablesRaw : JSON.parse(functionInputVariablesRaw)
            } catch (exception) {
                throw new Error('Invalid JSON in the Custom Python Function Input Variables: ' + exception)
            }
        }

        for (const key in inputVars) {
            let value = inputVars[key]
            if (typeof value === 'string') {
                value = handleEscapeCharacters(value, true)
                if (value.startsWith('{') && value.endsWith('}')) {
                    try {
                        value = JSON.parse(value)
                    } catch (e) {
                    }
                }
                inputVars[key] = value
            }
        }

        const scriptData = {
            input_text: input,
            vars: prepareSandboxVars(variables),
            flow: flow,
            ...inputVars
        }

        const tempDir = os.tmpdir()
        const scriptPath = path.join(tempDir, `flowise_python_${Date.now()}_${Math.random().toString(36).substring(7)}.py`)

        const pythonScript = `
import json
import sys

# Load input data
input_data = json.loads('''${JSON.stringify(scriptData).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}''')

# Extract variables
input_text = input_data.get('input_text', '')
vars = input_data.get('vars', {})
flow = input_data.get('flow', {})

# Extract custom input variables
${Object.keys(inputVars)
    .map((key) => `${key} = input_data.get('${key}', None)`)
    .join('\n')}

# User's custom function
def custom_function():
${pythonFunction
    .split('\n')
    .map((line) => '    ' + line)
    .join('\n')}

# Execute and return result
try:
    result = custom_function()
    # Convert result to JSON-compatible format
    if result is not None:
        print(json.dumps(result, default=str))
    else:
        print(json.dumps(None))
except Exception as e:
    print(json.dumps({'error': str(e)}), file=sys.stderr)
    sys.exit(1)
`

        fs.writeFileSync(scriptPath, pythonScript, 'utf-8')

        try {
            const result = await this.executePythonScript(pythonPath, scriptPath)

            try {
                fs.unlinkSync(scriptPath)
            } catch (cleanupError) {
                console.warn('Failed to clean up temporary Python file:', cleanupError)
            }

            let parsedResult
            try {
                parsedResult = JSON.parse(result)
            } catch (e) {
                parsedResult = result
            }

            if (typeof parsedResult === 'string' && !isEndingNode) {
                return handleEscapeCharacters(parsedResult, false)
            }
            return parsedResult
        } catch (error) {
            try {
                fs.unlinkSync(scriptPath)
            } catch (cleanupError) {
            }
            throw error
        }
    }

    private executePythonScript(pythonPath: string, scriptPath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const pythonProcess = spawn(pythonPath, [scriptPath])
            let output = ''
            let errorOutput = ''

            pythonProcess.stdout.on('data', (data) => {
                output += data.toString()
            })

            pythonProcess.stderr.on('data', (data) => {
                errorOutput += data.toString()
            })

            pythonProcess.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`Python script execution failed with code ${code}: ${errorOutput || output}`))
                } else {
                    resolve(output.trim())
                }
            })

            pythonProcess.on('error', (error) => {
                reject(new Error(`Failed to start Python process: ${error.message}`))
            })
        })
    }

    async run(nodeData: INodeData, input: string, options: ICommonObject): Promise<string> {
        return await this.init(nodeData, input, { ...options, isRun: true })
    }
}

module.exports = { nodeClass: CustomPythonFunction_Utilities }
