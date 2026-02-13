import axios from 'axios'
import { z } from 'zod'
import { StructuredTool, ToolParams } from '@langchain/core/tools'
import { ICommonObject, INode, INodeData, INodeParams } from '../../../src/Interface'
import { getBaseClasses, getCredentialData, getCredentialParam } from '../../../src/utils'

interface GoogleBooksSearchToolParams extends ToolParams {
    apiToken: string
}

class GoogleBooksSearchTool extends StructuredTool {
    static lc_name() {
        return 'GoogleBooksSearchTool'
    }

    name = 'google_books_search'

    description = 'Search for books using Google Books API and return raw JSON response'

    schema = z.object({
        query: z.string().describe('The search term')
    }) as any

    apiToken: string

    constructor({ apiToken, ...rest }: GoogleBooksSearchToolParams) {
        super(rest)
        this.apiToken = apiToken
    }

    async _call({ query }: z.infer<typeof this.schema>): Promise<string> {
        try {
            const response = await axios.get('https://www.googleapis.com/books/v1/volumes', {
                params: {
                    q: query,
                    key: this.apiToken
                }
            })
            return JSON.stringify(response.data)
        } catch (error: any) {
            const errorData = error?.response?.data || error?.message || 'Unknown error'
            return JSON.stringify({ error: errorData })
        }
    }
}

class GoogleBooksAPI_Tools implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    credential: INodeParams
    inputs: INodeParams[]

    constructor() {
        this.label = 'Google Books API'
        this.name = 'googleBooksAPI'
        this.version = 1.0
        this.type = 'GoogleBooksAPI'
        this.icon = 'google.svg'
        this.category = 'Tools'
        this.description =
            'Search for books using Google Books API and retrieve details like title, authors, preview link, and book ID'
        this.inputs = []
        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['googleBooksApi']
        }
        this.baseClasses = [this.type, 'Tool', ...getBaseClasses(GoogleBooksSearchTool)]
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        const credentialData = await getCredentialData(nodeData.credential ?? '', options)
        const googleBooksApiToken = getCredentialParam('googleBooksApiToken', credentialData, nodeData)
        return new GoogleBooksSearchTool({ apiToken: googleBooksApiToken })
    }
}

module.exports = { nodeClass: GoogleBooksAPI_Tools }
