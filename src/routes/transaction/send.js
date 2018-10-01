const uuid = require('uuid')
const util = require('util')

module.exports = async (request, response) => {
    const { currentPassword, from, to, toEmail, contract } = request.body
    let { amount } = request.body
    const {
        chain,
        network,
        userId,
        userEmail,
        firebase,
        privateData,
        provider
    } = request.injected

    if (!currentPassword || !from || !to || !amount) {
        return response.submit(false, 'MISSING_PARAMS')
    }

    if (isNaN(amount) && amount !== 'all') {
        return response.submit(false, 'Non-numerical amount provided.')
    }

    const privateKey = privateData[from]

    if (!privateKey) {
        return response.submit(
            false,
            `Authorized user does not have a private key for address: ${from}`
        )
    }

    if (chain === 'eth') {
        let tx = {
            from,
            to,
            nonce: provider.utils.toHex(
                await provider.eth.getTransactionCount(from)
            ),
            gasPrice: provider.utils.toWei('42', 'gwei'),
            gasLimit: 21000,
            value: provider.utils.toWei(`${amount}`, 'ether'),
            chainId: network // TODO: Select chain id correctly
        }

        if (
            contract &&
            process.env[`${process.env.CURRENT_STAGE.toUpperCase()}_ZTX_CONTRACT`]
        ) {
            const _contract = new provider.eth.Contract(
                require('./ERC20ABI'),
                process.env[
                    `${process.env.CURRENT_STAGE.toUpperCase()}_ZTX_CONTRACT`
                ]
            )

            tx.value = '0x00'
            tx.to =
                process.env[
                    `${process.env.CURRENT_STAGE.toUpperCase()}_ZTX_CONTRACT`
                ]
            tx.gasLimit = 100000
            tx.data = _contract.methods
                .transfer(to, provider.utils.toWei(`${amount}`, 'ether'))
                .encodeABI()
        }

        try {
            let signedTransaction = await provider.eth.accounts.signTransaction(
                tx,
                privateKey
            )

            let rawTransaction = signedTransaction.rawTransaction

            const promiseHack = () =>
                new Promise((resolve, reject) => {
                    provider.eth
                        .sendSignedTransaction(rawTransaction)
                        .on('transactionHash', hash => {
                            return resolve(hash)
                        })
                        .catch(err => {
                            return reject(err)
                        })
                })

            const interfaceMockId = uuid.v4()
            const transactionHash = await promiseHack()
            const transaction = {}
            transaction._hash = transactionHash
            transaction._amount = amount
            transaction._recipient = to
            transaction._recipientEmail = toEmail
            transaction._sender = from
            transaction._senderEmail = userEmail
            transaction._createdAt = Date.now()
            transaction._userInterfaceMockId = interfaceMockId
            transaction._status = 'pending'
            transaction._type = contract ? 'ZTX' : 'ETH'
            transaction._parties = { [from]: true, [to]: true }

            await firebase
                .firestore()
                .collection('transactions')
                .doc(transactionHash)
                .set(transaction, { merge: true })

            return response.submit(true, { transaction: transactionHash })
        } catch (err) {
            return response.submit(false, err.message || err.toString())
        }
    } else if (chain === 'ltc') {
        const { litecore, insight, minConf } = require('server/utils/ltc')

        const bitcoin = require('bitcoinjs-lib')
        let network =
            process.env.CURRENT_STAGE !== 'development'
                ? bitcoin.networks.litecoin
                : bitcoin.networks.litecoinTestnet

        // Validate the wallets.
        if (!litecore.Address.isValid(from))
            return response.submit(false, `Invalid wallet (from): ${from}`)
        if (!litecore.Address.isValid(to))
            return response.submit(false, `Invalid wallet (from): ${to}`)

        // Get unspent transactions
        const getUtxos = util.promisify(insight.getUtxos).bind(insight)

        let utxos
        try {
            utxos = await getUtxos({ addresses: from, minconf: minConf })
        } catch (err) {
            return response.submit(false, err.message || err.toString())
        }

        if (utxos.length === 0) return response.submit(false, `NO_UTXO`)

        let jsonUtxos = []
        utxos.forEach(utxo => {
            let jsonUtxo = utxo.toJSON()
            jsonUtxo.value = utxo.satoshis
            jsonUtxos.push(jsonUtxo)
        })

        // Get necessary keys
        let keyPair = bitcoin.ECPair.fromWIF(privateKey, network)
        const p2wpkh = bitcoin.payments.p2wpkh({
            pubkey: keyPair.publicKey,
            network
        })
        const p2sh = bitcoin.payments.p2sh({ redeem: p2wpkh, network })

        let feeRate = 110 // satoshis per byte

        let amountInSatoshis
        let inputs, outputs, fee
        if (amount === 'all') {
            let data = require('coinselect/split')(
                jsonUtxos,
                [{ address: to }],
                feeRate
            )

            inputs = data.inputs
            outputs = data.outputs
            fee = data.fee

            let value = 0
            inputs.forEach(input => {
                value += input.value
            })

            amountInSatoshis = value
            amount = litecore.Unit.fromSatoshis(amountInSatoshis).toBTC()
        } else {
            // Prepare the transaction
            amountInSatoshis = litecore.Unit.fromBTC(amount).toSatoshis()

            //TODO: when implementing zulu service charge, 'send all' will be done here because there will be more than one output
            let targets = [
                {
                    address: to,
                    value: amountInSatoshis
                }
            ]

            let data = require('coinselect')(jsonUtxos, targets, feeRate)

            inputs = data.inputs
            outputs = data.outputs
            fee = data.fee
        }

        //if coinselect couldn't build inputs/outputs, maybe the user is trying to sendAll by manually specifying the full amount instead of choosing "all" for the amount
        //so lets try to build the transaction with the "split" algorithm for the sendAll approach
        if (!inputs || !outputs) {
            let data = require('coinselect/split')(
                jsonUtxos,
                [{ address: to }],
                feeRate
            )

            inputs = data.inputs
            outputs = data.outputs
            fee = data.fee

            let value = 0
            inputs.forEach(input => {
                value += input.value
            })

            amountInSatoshis = value
            amount = litecore.Unit.fromSatoshis(amountInSatoshis).toBTC()
        }

        //if there coinselect STILL couldn't build inputs/outputs, then there is a problem like not enough funds or confirmed UTXOs
        if (!inputs || !outputs) {
            return response.submit(false, `INPUT_OUTPUT`)
        }

        let txb = new bitcoin.TransactionBuilder(network)
        inputs.forEach(input => txb.addInput(input.txid, input.vout))
        outputs.forEach(output => {
            if (!output.address) {
                output.address = from
            }

            txb.addOutput(output.address, output.value)
        })

        // Sign the transaction
        let i
        for (i = 0; i < inputs.length; i++) {
            txb.sign(i, keyPair, p2sh.redeem.output, null, inputs[i].value)
        }

        let tx = txb.build()
        let rawTransaction = tx.toHex()

        // Broadcast the raw transaction
        const broadcast = util.promisify(insight.broadcast).bind(insight)
        let broadcastPromise = new Promise((resolve, reject) => {
            broadcast(rawTransaction)
                .then(txid => resolve(txid))
                .catch(error => reject(error.toString()))
        })

        let txid
        try {
            txid = await broadcastPromise
        } catch (err) {
            return response.submit(
                false,
                `The following error occurred while broadcasting the transaction: ${err}`
            )
        }
        if (!txid)
            return response.submit(false, `Could not broadcast the transaction.`)

        const getTransactionPromise = util
            .promisify(insight.getTransaction)
            .bind(insight)
        const transaction = await getTransactionPromise(txid)
        if (!transaction)
            return response.submit(
                false,
                `Could not fetch transaction details from the blockchain.`
            )

        transaction.value = amountInSatoshis.toString()
        transaction._amount = Number(amount)
        transaction._hash = txid
        transaction._recipient = to
        transaction._recipientEmail = toEmail
        transaction._sender = from
        transaction._senderEmail = userEmail
        transaction._createdAt = Date.now()
        transaction._userInterfaceMockId = uuid.v4()
        transaction._status = 'pending'
        transaction._type = 'LTC'

        let ins = transaction.vin
        let outs = transaction.vout

        let parties = []
        let preventDupes = {}
        ins.forEach(input => {
            let address = input.addr
            if (!preventDupes[address]) {
                parties.push(address)
                preventDupes[address] = true
            }
        })

        outs.forEach(output => {
            let addresses = output.scriptPubKey.addresses
            addresses.forEach(address => {
                if (!preventDupes[address]) {
                    parties.push(address)
                    preventDupes[address] = true
                }
            })
        })

        transaction._parties = parties

        await firebase
            .firestore()
            .collection('transactions')
            .doc(txid)
            .set(transaction, { merge: true })

        return response.submit(true, { transaction: txid })
    } else {
        return response.submit(false, 'NOT_IMPLEMENTED')
    }
}

