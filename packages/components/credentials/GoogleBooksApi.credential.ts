import { INodeParams, INodeCredential } from '../src/Interface'

class GoogleBooksApi implements INodeCredential {
    label: string
    name: string
    version: number
    description: string
    inputs: INodeParams[]

    constructor() {
        this.label = 'Google Books API'
        this.name = 'googleBooksApi'
        this.version = 1.0
        this.description =
            'Create an API key from the <a target="_blank" href="https://console.cloud.google.com/apis/credentials">Google Cloud Console</a> and use it as token for Google Books API.'
        this.inputs = [
            {
                label: 'Google Books API Token',
                name: 'googleBooksApiToken',
                type: 'password'
            }
        ]
    }
}

module.exports = { credClass: GoogleBooksApi }
