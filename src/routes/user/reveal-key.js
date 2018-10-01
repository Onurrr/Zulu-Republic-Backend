module.exports = async (request, response) => {
    const { chain, privateData } = request.injected
    const { address, currentPassword } = request.body

    if (!address || !currentPassword) {
        return response.submit(false, 'MISSING_PARAMS')
    }

    if (chain === 'eth') {
        return response.submit(true, {
            privateKey: privateData[address.toLowerCase()]
        })
    }

    else if (chain === 'ltc') {
        let xprv = privateData.xprv
        let bitcoin = require('bitcoinjs-lib')
        let network =
            process.env.CURRENT_STAGE !== 'development'
                ? bitcoin.networks.litecoin
                : bitcoin.networks.litecoinTestnet
        let node = bitcoin.bip32.fromBase58(xprv, network)
        let privateKey = node.toWIF()

        const phrase = privateData.phrase

        return response.submit(true, { privateKey, phrase })
    }

    else {
        return response.submit(false, 'NOT_IMPLEMENTED')
    }
}
