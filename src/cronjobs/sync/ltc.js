const explorers = require('litecore-explorers')
const litecore = explorers.litecore
const uuid = require('uuid')

const networkName =
    process.env.CURRENT_STAGE !== 'development' ? 'mainnet' : 'testnet'
const insightPort = process.env.CURRENT_STAGE !== 'development' ? '3001' : '3002'
const insight = new explorers.Insight(
    `http://${process.env.LTC_NODE}:${insightPort}`,
    networkName
)
litecore.Networks.defaultNetwork = litecore.Networks[networkName]

let addresses = {}
let storedTransactions = {}
let updateBalancePromises = []
module.exports = async firebase => {
    let blocksPromise = new Promise((resolve, reject) => {
        insight.getBlocks((err, blocks) => {
            if (err) {
                reject(err)
            } else {
                resolve(blocks)
            }
        })
    })

    let blocks, currentBlockHeight
    try {
        let blockData = await blocksPromise
        blocks = blockData.blocks
        currentBlockHeight = blocks[0].height
    } catch (err) {
        //TODO err
        console.error(err)
    }

    if (!blocks || !currentBlockHeight) console.error('could not fetch block data') //TODO err

    return firebase
        .firestore()
        .collection('transactions')
        .doc('_state')
        .get()
        .then(async doc => {
            if (!doc.exists) {
                return console.error(
                    'Error syncing transactions: Could not fetch last synced block.'
                )
            }

            const { lastSyncedBlock, retryBlocks, isSyncing, started } = doc.data()

            let transactionPromises = []
            if (retryBlocks) {
                await firebase
                    .firestore()
                    .collection('transactions')
                    .doc('_state')
                    .set({ retryBlocks: {} }, { merge: true })
                    .then(() => {
                        Object.keys(retryBlocks).forEach(async key => {
                            let promise = await getRetryBlockPromises(firebase, key)
                            transactionPromises.push(promise)
                        })
                    })
            }

            if (
                lastSyncedBlock < currentBlockHeight &&
                (isSyncing === false || Date.now() - started >= 300000)
            ) {
                await firebase
                    .firestore()
                    .collection('transactions')
                    .doc('_state')
                    .set(
                        {
                            isSyncing: true,
                            started: Date.now()
                        },
                        { merge: true }
                    )

                for (
                    let index = lastSyncedBlock + 1;
                    index <= currentBlockHeight;
                    index++
                ) {
                    let promise = getPromisesFromBlock(firebase, index, blocks)
                    transactionPromises.push(promise)
                }

                if (transactionPromises === []) {
                    return await doc.ref
                        .update({
                            lastSyncedBlock: currentBlockHeight,
                            isSyncing: false
                        })
                        .then(() => {
                            return true
                        })
                } else {
                    return Promise.all(transactionPromises)
                        .then(() => {
                            if (updateBalancePromises) {
                                return Promise.all(updateBalancePromises).then(
                                    () => {
                                        return doc.ref
                                            .update({
                                                lastSyncedBlock: currentBlockHeight,
                                                isSyncing: false
                                            })
                                            .then(() => {
                                                updateBalancePromises = []
                                                addresses = {}
                                                storedTransactions = {}
                                                return true
                                            })
                                            .catch(err => {
                                                updateBalancePromises = []
                                                addresses = {}
                                                storedTransactions = {}
                                                return console.error(err)
                                            })
                                    }
                                )
                            } else {
                                return doc.ref
                                    .update({
                                        lastSyncedBlock: currentBlockHeight,
                                        isSyncing: false
                                    })
                                    .then(() => {
                                        updateBalancePromises = []
                                        addresses = {}
                                        storedTransactions = {}

                                        return true
                                    })
                                    .catch(err => {
                                        updateBalancePromises = []
                                        addresses = {}
                                        storedTransactions = {}
                                        return console.error(err)
                                    })
                            }
                        })
                        .catch(err => {
                            updateBalancePromises = []
                            addresses = {}
                            return console.error('Sync job failed with error: ', err)
                        })
                }
            }
        })
}

const getBlockByHeight = (blocks, height) => {
    return blocks.filter(blocks => {
        return blocks.height === height
    })[0]
}

const getRetryBlockPromises = async (firebase, index) => {
    let searchPromises = []
    try {
        //get block hash here
        let blockHashPromise = new Promise((resolve, reject) => {
            insight.getBlockIndex(index, (err, hash) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(hash)
                }
            })
        })

        let blockHash = await blockHashPromise
        if (!blockHash) {
            return firebase
                .firestore()
                .collection('transactions')
                .doc('_state')
                .set({ retryBlocks: { [index]: true } }, { merge: true })
                .then(() => {
                    return true
                })
        } else {
            let blockPromise = new Promise((resolve, reject) => {
                insight.getBlock(blockHash, (err, block) => {
                    if (err) {
                        reject(err)
                    } else {
                        resolve(block)
                    }
                })
            })

            let blockData
            try {
                blockData = await blockPromise
            } catch (err) {
                console.error(err)
                return firebase
                    .firestore()
                    .collection('transactions')
                    .doc('_state')
                    .set({ retryBlocks: { [index]: true } }, { merge: true })
                    .then(() => {
                        return true
                    })
            }

            if (blockData.tx && blockData.tx.length > 0) {
                blockData.tx.forEach(txid => {
                    insight.getTransaction(txid, (err, tx) => {
                        if (err) {
                            console.error(err)
                            return firebase
                                .firestore()
                                .collection('transactions')
                                .doc('_state')
                                .set(
                                    { retryBlocks: { [index]: true } },
                                    { merge: true }
                                )
                                .then(() => {
                                    return true
                                })
                        } else {
                            let inputs = tx.vin
                            let outputs = tx.vout

                            if (!inputs && !outputs) return

                            if (inputs) {
                                inputs.forEach(input => {
                                    let address = input.addr
                                    if (address) {
                                        searchPromises.push(
                                            checkIfRelevant(firebase, address, tx)
                                        )
                                    }
                                })
                            }

                            if (outputs) {
                                outputs.forEach(output => {
                                    if (output.scriptPubKey.addresses) {
                                        let addresses = output.scriptPubKey.addresses
                                        addresses.forEach(address => {
                                            if (address) {
                                                searchPromises.push(
                                                    checkIfRelevant(
                                                        firebase,
                                                        address,
                                                        tx
                                                    )
                                                )
                                            }
                                        })
                                    }
                                })
                            }
                        }
                    })
                })

                return Promise.all(searchPromises)
            }
        }
    } catch (err) {
        console.error(err)
        return firebase
            .firestore()
            .collection('transactions')
            .doc('_state')
            .set({ retryBlocks: { [index]: true } }, { merge: true })
            .then(() => {
                return true
            })
    }
}

const getPromisesFromBlock = async (firebase, index, blocks) => {
    let searchPromises = []
    try {
        let block = getBlockByHeight(blocks, index)
        if (!block) {
            return firebase
                .firestore()
                .collection('transactions')
                .doc('_state')
                .set({ retryBlocks: { [index]: true } }, { merge: true })
                .then(() => {
                    return true
                })
        } else {
            let blockPromise = new Promise((resolve, reject) => {
                insight.getBlock(block.hash, (err, block) => {
                    if (err) {
                        reject(err)
                    } else {
                        resolve(block)
                    }
                })
            })

            let blockData
            try {
                blockData = await blockPromise
            } catch (err) {
                console.error(err)
                return firebase
                    .firestore()
                    .collection('transactions')
                    .doc('_state')
                    .set({ retryBlocks: { [index]: true } }, { merge: true })
                    .then(() => {
                        return true
                    })
            }
            if (blockData.tx && blockData.tx.length > 0) {
                blockData.tx.forEach(txid => {
                    insight.getTransaction(txid, (err, tx) => {
                        if (err) {
                            console.error(err)
                            return firebase
                                .firestore()
                                .collection('transactions')
                                .doc('_state')
                                .set(
                                    { retryBlocks: { [index]: true } },
                                    { merge: true }
                                )
                                .then(() => {
                                    return true
                                })
                        } else {
                            let inputs = tx.vin
                            let outputs = tx.vout

                            if (!inputs && !outputs) return

                            if (inputs) {
                                inputs.forEach(input => {
                                    let address = input.addr
                                    if (address) {
                                        searchPromises.push(
                                            checkIfRelevant(firebase, address, tx)
                                        )
                                    }
                                })
                            }

                            if (outputs) {
                                outputs.forEach(output => {
                                    if (output.scriptPubKey.addresses) {
                                        let addresses = output.scriptPubKey.addresses
                                        addresses.forEach(address => {
                                            if (address) {
                                                searchPromises.push(
                                                    checkIfRelevant(
                                                        firebase,
                                                        address,
                                                        tx
                                                    )
                                                )
                                            }
                                        })
                                    }
                                })
                            }
                        }
                    })
                })

                return Promise.all(searchPromises)
            }
        }
    } catch (err) {
        console.error(err)
        return firebase
            .firestore()
            .collection('transactions')
            .doc('_state')
            .set({ retryBlocks: { [index]: true } }, { merge: true })
            .then(() => {
                return true
            })
    }
}

const checkIfRelevant = async (firebase, address, tx) => {
    let txid = tx.txid
    if (!storedTransactions[txid]) {
        await firebase
            .firestore()
            .collection('wallets')
            .where('address', '==', address)
            .limit(1)
            .get()
            .then(async snapshot => {
                if (snapshot.size > 0 && snapshot.docs[0].exists) {
                    if (!addresses[address]) {
                        addresses[address] = true
                        updateBalancePromises.push(updateBalance(firebase, address))
                    }
                    return await storeTransaction(firebase, tx)
                        .then(() => {
                            storedTransactions[txid] = true
                            return true
                        })
                        .catch(err => {
                            return console.error(err)
                        })
                }
            })
            .catch(err => {
                return console.error(err)
            })
    } else {
        return true
    }
}

const storeTransaction = async (firebase, tx) => {
    try {
        const transactionRef = firebase
            .firestore()
            .collection('transactions')
            .doc(tx.txid)

        tx._status = 'confirmed'

        const getTransactionDoc = await transactionRef.get()
        if (!getTransactionDoc || !getTransactionDoc.exists) {
            //this must be an out-of-network transaction, since it doesn't already exist

            let from = tx.vin[0].addr
            let timestamp = new Date(tx.time * 1000).getTime()

            let inputs = tx.vin
            let outputs = tx.vout

            let parties = []
            let preventDupes = {}

            if (inputs) {
                inputs.forEach(input => {
                    let address = input.addr
                    if (!preventDupes[address]) {
                        preventDupes[address] = true
                        parties.push(address)
                    }
                })
            }

            const axios = require('axios')
            let promises = []
            if (outputs) {
                outputs.forEach(output => {
                    let addresses = output.scriptPubKey.addresses
                    if (addresses && addresses.length) {
                        addresses.forEach(address => {
                            if (!preventDupes[address]) {
                                preventDupes[address] = true
                                parties.push(address)
                            }

                            //find the relevant outputs to determine the value of the transaction
                            promises.push(
                                firebase
                                    .firestore()
                                    .collection('wallets')
                                    .where('address', '==', address)
                                    .limit(1)
                                    .get()
                                    .then(snapshot => {
                                        if (
                                            snapshot.size > 0 &&
                                            snapshot.docs[0].exists
                                        ) {
                                            return output
                                        }
                                    })
                                    .catch(err => {
                                        return console.error(err)
                                    })
                            )
                        })
                    }
                })
            }

            let to
            let value = 0
            if (promises) {
                await Promise.all(promises).then(result => {
                    if (Array.isArray(result)) {
                        result.forEach(async out => {
                            if (out) {
                                value += Number(out.value)
                                to = out.scriptPubKey.addresses[0]

                                let webhook
                                switch (process.env.CURRENT_STAGE) {
                                    case 'production':
                                        webhook = process.env.LITE_IM_WEBHOOK
                                        break
                                    default:
                                }

                                await axios({
                                    method: 'post',
                                    url: webhook,
                                    data: {
                                        address: to,
                                        sender: from,
                                        amount: out.value,
                                        txid: tx.txid
                                    }
                                })
                            }
                        })
                    } else {
                        value = Number(result.value)
                        to = result.scriptPubKey.addresses[0]
                    }
                })
            } else {
                value = Number(tx.vout[0].value)
                to = tx.vout[0].scriptPubKey.addresses[0]
            }
            tx._amount = value
            tx.value = litecore.Unit.fromBTC(value)
                .toSatoshis()
                .toString()

            tx._type = 'LTC'
            tx._parties = parties //this is so we can query "from x OR to x"

            if (from) tx._sender = from
            if (to) tx._recipient = to
            tx._createdAt = timestamp
            tx._hash = tx.txid
            tx._userInterfaceMockId = uuid.v4()
        }

        if (tx && tx.txid) {
            return firebase
                .firestore()
                .collection('transactions')
                .doc(tx.txid)
                .set(tx, { merge: true })
                .catch(err => {
                    return console.error(err)
                })
        }
    } catch (err) {
        return await firebase
            .firestore()
            .collection('transactions')
            .doc('_state')
            .set({ retryBlocks: { [tx.blockheight]: true } }, { merge: true })
            .then(() => {
                return console.error(err)
            })
            .catch(err => {
                return console.error(err)
            })
    }
}

const updateBalance = async (firebase, address) => {
    await insight.address(address, (err, data) => {
        if (err) {
            //TODO handle err
            return console.error(err)
        } else {
            let balance = litecore.Unit.fromSatoshis(data.balance)
                .toBTC()
                .toString()

            let currencies = {
                currencies: {
                    ltc: balance
                }
            }

            return firebase
                .firestore()
                .collection('wallets')
                .doc(address)
                .set(currencies, { merge: true })
                .then(() => {
                    return true
                })
                .catch(err => {
                    return console.error(err)
                })
        }
    })
}
