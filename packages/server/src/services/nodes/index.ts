import { cloneDeep } from 'lodash'
import { StatusCodes } from 'http-status-codes'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import { INodeData } from '../../Interface'
import { INodeOptionsValue, ICommonObject, handleEscapeCharacters } from 'flowise-components'
import { databaseEntities } from '../../utils'
import logger from '../../utils/logger'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getErrorMessage } from '../../errors/utils'

// Get all component nodes
const getAllNodes = async () => {
    try {
        const appServer = getRunningExpressApp()
        const dbResponse = []
        for (const nodeName in appServer.nodesPool.componentNodes) {
            const clonedNode = cloneDeep(appServer.nodesPool.componentNodes[nodeName])
            dbResponse.push(clonedNode)
        }
        return dbResponse
    } catch (error) {
        throw new InternalFlowiseError(StatusCodes.INTERNAL_SERVER_ERROR, `Error: nodesService.getAllNodes - ${getErrorMessage(error)}`)
    }
}

// Get all component nodes for a specific category
const getAllNodesForCategory = async (category: string) => {
    try {
        const appServer = getRunningExpressApp()
        const dbResponse = []
        for (const nodeName in appServer.nodesPool.componentNodes) {
            const componentNode = appServer.nodesPool.componentNodes[nodeName]
            if (componentNode.category === category) {
                const clonedNode = cloneDeep(componentNode)
                dbResponse.push(clonedNode)
            }
        }
        return dbResponse
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: nodesService.getAllNodesForCategory - ${getErrorMessage(error)}`
        )
    }
}

// Get specific component node via name
const getNodeByName = async (nodeName: string) => {
    try {
        const appServer = getRunningExpressApp()
        if (Object.prototype.hasOwnProperty.call(appServer.nodesPool.componentNodes, nodeName)) {
            const dbResponse = appServer.nodesPool.componentNodes[nodeName]
            return dbResponse
        } else {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Node ${nodeName} not found`)
        }
    } catch (error) {
        throw new InternalFlowiseError(StatusCodes.INTERNAL_SERVER_ERROR, `Error: nodesService.getAllNodes - ${getErrorMessage(error)}`)
    }
}

// Returns specific component node icon via name
const getSingleNodeIcon = async (nodeName: string) => {
    try {
        const appServer = getRunningExpressApp()
        if (Object.prototype.hasOwnProperty.call(appServer.nodesPool.componentNodes, nodeName)) {
            const nodeInstance = appServer.nodesPool.componentNodes[nodeName]
            if (nodeInstance.icon === undefined) {
                throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Node ${nodeName} icon not found`)
            }

            if (nodeInstance.icon.endsWith('.svg') || nodeInstance.icon.endsWith('.png') || nodeInstance.icon.endsWith('.jpg')) {
                const filepath = nodeInstance.icon
                return filepath
            } else {
                throw new InternalFlowiseError(StatusCodes.INTERNAL_SERVER_ERROR, `Node ${nodeName} icon is missing icon`)
            }
        } else {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Node ${nodeName} not found`)
        }
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: nodesService.getSingleNodeIcon - ${getErrorMessage(error)}`
        )
    }
}

const getSingleNodeAsyncOptions = async (nodeName: string, requestBody: any): Promise<any> => {
    try {
        const appServer = getRunningExpressApp()
        const nodeData: INodeData = requestBody
        if (Object.prototype.hasOwnProperty.call(appServer.nodesPool.componentNodes, nodeName)) {
            try {
                const nodeInstance = appServer.nodesPool.componentNodes[nodeName]
                const methodName = nodeData.loadMethod || ''

                const dbResponse: INodeOptionsValue[] = await nodeInstance.loadMethods![methodName]!.call(nodeInstance, nodeData, {
                    appDataSource: appServer.AppDataSource,
                    databaseEntities: databaseEntities
                })

                return dbResponse
            } catch (error) {
                return []
            }
        } else {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Node ${nodeName} not found`)
        }
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: nodesService.getSingleNodeAsyncOptions - ${getErrorMessage(error)}`
        )
    }
}

// execute custom function node
const executeCustomFunction = async (requestBody: any) => {
    try {
        const appServer = getRunningExpressApp()
        const body = requestBody
        const functionInputVariables = Object.fromEntries(
            [...(body?.javascriptFunction ?? '').matchAll(/\$([a-zA-Z0-9_]+)/g)].map((g) => [g[1], undefined])
        )
        // Support for Python custom function: accept `pythonFunction` and `functionInputVariables` from body
        const pythonFunctionInputVariables = body?.functionInputVariables ?? {}
        if (functionInputVariables && Object.keys(functionInputVariables).length) {
            for (const key in functionInputVariables) {
                if (key.includes('vars')) {
                    delete functionInputVariables[key]
                }
            }
        }
        const nodeData = { inputs: { functionInputVariables, ...body } }
        // Heuristic: consider Python if `pythonFunction` provided or if `javascriptFunction` looks like Python source
        const looksLikePython = (code?: string) => {
            if (!code || typeof code !== 'string') return false
            return /\bdef\b|\bimport\b|\bprint\(/.test(code)
        }

        const prefersPython = Boolean(body?.pythonFunction) || looksLikePython(body?.javascriptFunction)

        // If Python is preferred and python node is available, execute `customPythonFunction`
        if (prefersPython && Object.prototype.hasOwnProperty.call(appServer.nodesPool.componentNodes, 'customPythonFunction')) {
            try {
                const nodeInstanceFilePath = appServer.nodesPool.componentNodes['customPythonFunction'].filePath as string
                let nodeModule: any
                try {
                    // clear require cache and load fresh module
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    delete require.cache[require.resolve(nodeInstanceFilePath)]
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    nodeModule = require(nodeInstanceFilePath)
                } catch (reqErr) {
                    throw reqErr
                }
                const newNodeInstance = new nodeModule.nodeClass()

                const options: ICommonObject = {
                    appDataSource: appServer.AppDataSource,
                    databaseEntities,
                    logger
                }

                // prepare nodeData for python: include provided functionInputVariables if any
                // If the client sent code in `javascriptFunction` but it looks like Python, use it as fallback
                const pythonCode = body.pythonFunction ?? body.javascriptFunction
                const pyNodeData = { inputs: { ...pythonFunctionInputVariables, pythonFunction: pythonCode, pythonPath: body.pythonPath, functionName: body.functionName } }

                const returnData = await newNodeInstance.init(pyNodeData, '', options)
                const dbResponse = typeof returnData === 'string' ? handleEscapeCharacters(returnData, true) : returnData

                return dbResponse
            } catch (error) {
                throw new InternalFlowiseError(StatusCodes.INTERNAL_SERVER_ERROR, `Error running custom python function: ${getErrorMessage(error)}`)
            }
        } else if (Object.prototype.hasOwnProperty.call(appServer.nodesPool.componentNodes, 'customFunction')) {
            try {
                const nodeInstanceFilePath = appServer.nodesPool.componentNodes['customFunction'].filePath as string
                let nodeModule: any
                try {
                    // clear require cache and load fresh module
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    delete require.cache[require.resolve(nodeInstanceFilePath)]
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    nodeModule = require(nodeInstanceFilePath)
                } catch (reqErr) {
                    throw reqErr
                }
                const newNodeInstance = new nodeModule.nodeClass()

                const options: ICommonObject = {
                    appDataSource: appServer.AppDataSource,
                    databaseEntities,
                    logger
                }

                const returnData = await newNodeInstance.init(nodeData, '', options)
                const dbResponse = typeof returnData === 'string' ? handleEscapeCharacters(returnData, true) : returnData

                return dbResponse
            } catch (error) {
                throw new InternalFlowiseError(StatusCodes.INTERNAL_SERVER_ERROR, `Error running custom function: ${error}`)
            }
        } else {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Node customFunction not found`)
        }
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: nodesService.executeCustomFunction - ${getErrorMessage(error)}`
        )
    }
}

export default {
    getAllNodes,
    getNodeByName,
    getSingleNodeIcon,
    getSingleNodeAsyncOptions,
    executeCustomFunction,
    getAllNodesForCategory
}
