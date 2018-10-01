const _ = require('lodash')

// TODO: Select between prod/rinkeby/staging

module.exports = express => {
    return express.use((request, response, next) => {
        const network = process.env.CHAIN
        const stage = process.env.CURRENT_STAGE

        if (network === 'eth') {
            const link = `https://${
                stage !== 'development' ? 'mainnet' : 'rinkeby'
            }.infura.io/${process.env.INFURA_API_KEY}`
            const Web3 = require('web3')
            const web3 = new Web3(new Web3.providers.HttpProvider(link))
            request.injected = _.merge({}, request.injected, {
                chain: network,
                provider: web3,
                network: stage !== 'development' ? 1 : 4
            })

            console.log('Link:', link)
        } else if (network === 'ltc') {
            request.injected = _.merge({}, request.injected, {
                chain: network
            })
        } else {
            return response.submit(false, 'Invalid network specified.')
        }

        return next()
    })
}
