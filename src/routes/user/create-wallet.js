const cryptography = require('server/utils/cryptography')
const util = require('util')

module.exports = async (request, response) => {
    const { chain, userId, provider, firebase, privateData } = request.injected
    const { currentPassword } = request.body
    let { isDefault } = request.body

    if (!currentPassword) {
        return response.submit(false, 'MISSING_PARAMS')
    }

    try {
        if (isDefault) {
            let snapshot = await firebase
                .firestore()
                .collection('wallets')
                .where('belongsTo', '==', userId)
                .where('isDefault', '==', true)
                .limit(1)
                .get()
            if (snapshot.docs.length > 0)
                return response.submit(
                    false,
                    `Default wallet already exists for user: ${userId}`
                )
        }

        let wallet = {}
        let createdBlock, currencies, blockchain

        if (chain === 'eth') {
            wallet = provider.eth.accounts.create()
            wallet.address = wallet.address.toLowerCase()
            wallet.privateKey = wallet.privateKey.toLowerCase()

            createdBlock = await provider.eth.getBlockNumber()

            privateData[wallet.address] = wallet.privateKey

            blockchain = 'ethereum'
            currencies = {
                ether: 0,
                litecoin: 0,
                ztx: 0
            }

        }

        else if (chain === 'ltc') {

            const { litecore, insight, minConf } = require('server/utils/ltc')

            const bitcoin = require('bitcoinjs-lib')
            const bip39 = require('bip39')

            let network =
                process.env.CURRENT_STAGE !== 'development'
                    ? bitcoin.networks.litecoin
                    : bitcoin.networks.litecoinTestnet

            let root, seed, xprv
            let accountNumber = 0
            if (typeof privateData === 'object' && Object.keys(privateData).length) {
                isDefault = false
                if (privateData['xprv']) {
                    accountNumber = Object.keys(privateData).length - 2 //-2 because we store the mnemonic phrase and the xprv
                    let xprv = privateData['xprv']
                    root = bitcoin.bip32.fromBase58(xprv, network)
                } else {
                    //TODO: create upgrade logic
                    return response.submit(false, 'UPGRADE_WALLET')
                }
            } else {
                isDefault = true
                let mnemonic = bip39.generateMnemonic()
                seed = bip39.mnemonicToSeed(mnemonic)
                root = bitcoin.bip32.fromSeed(seed, network)
                xprv = root.toBase58()

                privateData['phrase'] = mnemonic
                privateData['xprv'] = xprv
            }

            let child = root.derivePath(`m/44'/2'/0'/${accountNumber}`)
            let { address } = bitcoin.payments.p2sh({
                redeem: bitcoin.payments.p2wpkh({
                    pubkey: child.publicKey,
                    network
                }),
                network
            })
            let addressPrivkey = child.toWIF()

            wallet.address = address
            wallet.privateKey = addressPrivkey

            privateData[wallet.address] = wallet.privateKey

            const getBlocks = util
                .promisify(insight.getBlocks)
                .bind(insight)

            try {
                let blockData = await getBlocks()
                createdBlock = blockData.blocks[0].height
            } catch (err) {
                return response.submit(false, err.message || err.toString())
            }

            blockchain = 'litecoin'
            currencies = {
                ltc: 0
            }

        } else {
            return response.submit(false, 'NOT_IMPLEMENTED')
        }

        const serverKey = await cryptography.getKeyFromServer()
        const encrypt = cryptography.encryptDataOnServer(
            serverKey.key,
            currentPassword,
            JSON.stringify(privateData)
        )

        await firebase
            .firestore()
            .collection('encrypted_user_data')
            .doc(userId)
            .set({ data: encrypt.value, keyVersion: serverKey.version }, { merge: true })

        await firebase
            .firestore()
            .collection('wallets')
            .doc(wallet.address)
            .set({
                belongsTo: userId,
                isDefault: isDefault || false,
                address: wallet.address,
                blockchain,
                createdBlock,
                name: isDefault ? 'default' : wallet.address,
                currencies: currencies
            })

        return response.submit(true, {
            wallet: { address: wallet.address, privateKey: wallet.privateKey }
        })
    } catch (err) {
        return response.submit(false, err.message || err.toString())
    }
}
