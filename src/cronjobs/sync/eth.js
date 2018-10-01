const Web3 = require('web3')
const uuid = require('uuid')

let networkName = 'rinkeby'
if (process.env.CURRENT_STAGE === 'production') networkName = 'mainnet'
if (process.env.CURRENT_STAGE === 'staging') networkName = 'mainnet'

const web3 = new Web3(
    new Web3.providers.HttpProvider(
        `https://${networkName}.infura.io/${process.env.INFURA_API_KEY}`
    )
)

const ZTXContractAddress =
    process.env[`${process.env.CURRENT_STAGE.toUpperCase()}_ZTX_CONTRACT`] == 'null'
        ? null
        : process.env[`${process.env.CURRENT_STAGE.toUpperCase()}_ZTX_CONTRACT`]
const airdropContractAddress =
    process.env[`${process.env.CURRENT_STAGE.toUpperCase()}_AIRDROP_CONTRACT`] ==
    'null'
        ? null
        : process.env[`${process.env.CURRENT_STAGE.toUpperCase()}_AIRDROP_CONTRACT`]
const airdropExecutorAddress =
    process.env[
        `${process.env.CURRENT_STAGE.toUpperCase()}_AIRDROP_EXECUTOR_ADDRESS`
    ] == 'null'
        ? null
        : process.env[
              `${process.env.CURRENT_STAGE.toUpperCase()}_AIRDROP_EXECUTOR_ADDRESS`
          ]

let addresses = {}
let transactions = {}
let updateBalancePromises = []
module.exports = async firebase => {
    //check pending transactions to see if they have been confirmed
    await firebase
        .firestore()
        .collection('transactions')
        .where('_status', '==', 'pending')
        .get()
        .then(snapshot => {
            snapshot.forEach(async doc => {
                if (doc && doc.exists && !doc.data()._airdrop) {
                    let transaction = doc.data()
                    let receipt = await web3.eth.getTransactionReceipt(
                        transaction._hash
                    )

                    if (receipt) {
                        transaction._status =
                            receipt.status === true ? 'successful' : 'failed'

                        let txData = await web3.eth.getTransaction(transaction._hash)
                        if (txData) {
                            const completeTx = { ...transaction, ...txData }

                            await firebase
                                .firestore()
                                .collection('transactions')
                                .doc(transaction._hash)
                                .set(completeTx, { merge: true })
                        }
                    }
                }
            })
        })

    //fetch current blockheight
    const currentBlockHeight = await web3.eth.getBlockNumber()
    if (!currentBlockHeight)
        return console.error(
            'Error syncing transactions: Could not fetch current blockheight.'
        )

    //begin block syncing logic
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
                            let promise = await getPromisesFromBlock(firebase, key)
                            transactionPromises.push(promise)
                        })
                    })
            }

            if (
                lastSyncedBlock < currentBlockHeight &&
                (isSyncing === false || Date.now() - started >= 180000)
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
                    let promise = await getPromisesFromBlock(firebase, index)
                    transactionPromises.push(promise)
                }

                if (ZTXContractAddress) {
                    let promise = await getZTXTransactions(
                        firebase,
                        lastSyncedBlock,
                        currentBlockHeight
                    )
                    transactionPromises.push(promise)
                }
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
                    .then(async () => {
                        if (updateBalancePromises) {
                            return Promise.all(updateBalancePromises).then(() => {
                                return doc.ref
                                    .update({
                                        lastSyncedBlock: currentBlockHeight,
                                        isSyncing: false
                                    })
                                    .then(() => {
                                        updateBalancePromises = []
                                        addresses = {}
                                        return true
                                    })
                                    .catch(err => {
                                        updateBalancePromises = []
                                        addresses = {}
                                        return console.error(err)
                                    })
                            })
                        } else {
                            return doc.ref
                                .update({
                                    lastSyncedBlock: currentBlockHeight,
                                    isSyncing: false
                                })
                                .then(() => {
                                    updateBalancePromises = []
                                    addresses = {}
                                    return true
                                })
                                .catch(err => {
                                    updateBalancePromises = []
                                    addresses = {}
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
        })
        .catch(err => {
            updateBalancePromises = []
            addresses = {}
            return console.error(err)
        })
}

const getPromisesFromBlock = async (firebase, index) => {
    try {
        let searchPromises = []
        let blockData = await web3.eth.getBlock(index, true)

        if (!blockData) {
            await firebase
                .firestore()
                .collection('transactions')
                .doc('_state')
                .set({ retryBlocks: { [index]: true } }, { merge: true })
        } else {
            let blockTimestamp = new Date(blockData.timestamp * 1000).getTime()

            if (blockData.transactions && blockData.transactions.length > 0) {
                blockData.transactions.forEach(tx => {
                    if (!tx.from || !tx.to) return
                    let from = tx.from.toLowerCase()
                    let to = tx.to.toLowerCase()
                    if (
                        from === ZTXContractAddress ||
                        to === ZTXContractAddress ||
                        from === airdropContractAddress ||
                        to === airdropContractAddress ||
                        from === '0x0000000000000000000000000000000000000000' ||
                        to === '0x0000000000000000000000000000000000000000'
                    )
                        return

                    searchPromises.push(
                        firebase
                            .firestore()
                            .collection('wallets')
                            .where('address', '==', from)
                            .limit(1)
                            .get()
                            .then(snapshot => {
                                if (snapshot.size > 0 && snapshot.docs[0].exists) {
                                    if (!addresses[from]) {
                                        addresses[from] = true
                                        updateBalancePromises.push(
                                            updateBalance(firebase, from)
                                        )
                                    }

                                    if (!transactions[tx.hash]) {
                                        transactions[tx.hash] = true
                                        return storeTransaction(
                                            firebase,
                                            tx,
                                            blockTimestamp
                                        )
                                    }
                                }
                            })
                            .catch(err => {
                                return console.error(err)
                            })
                    )

                    searchPromises.push(
                        firebase
                            .firestore()
                            .collection('wallets')
                            .where('address', '==', to)
                            .limit(1)
                            .get()
                            .then(snapshot => {
                                if (snapshot.size > 0 && snapshot.docs[0].exists) {
                                    if (!addresses[to]) {
                                        addresses[to] = true
                                        updateBalancePromises.push(
                                            updateBalance(firebase, to)
                                        )
                                    }
                                    if (!transactions[tx.hash]) {
                                        transactions[tx.hash] = true
                                        return storeTransaction(
                                            firebase,
                                            tx,
                                            blockTimestamp
                                        )
                                    }
                                }
                            })
                            .catch(err => {
                                return console.error(err)
                            })
                    )
                })

                return Promise.all(searchPromises)
            }
        }
    } catch (err) {
        console.error(err)
        await firebase
            .firestore()
            .collection('transactions')
            .doc('_state')
            .set({ retryBlocks: { [index]: true } }, { merge: true })
    }
}

const storeTransaction = async (firebase, tx, blockTimestamp) => {
    try {
        const transactionData = await addTransactionMetadata(
            firebase,
            tx,
            blockTimestamp
        )

        // only store this transaction if addTransactionMetadata added new information
        // this is to avoid double saving a pending transaction that has now been confirmed.
        // failures within addTransactionMetadata are handled in its method
        if (transactionData) {
            await firebase
                .firestore()
                .collection('transactions')
                .doc(tx.hash)
                .set(transactionData, { merge: true })
                .then(() => {
                    return true
                })
                .catch(err => {
                    console.error(err)
                    return false
                })
        }
    } catch (err) {
        console.error(err)
        await firebase
            .firestore()
            .collection('transactions')
            .doc('_state')
            .set({ retryBlocks: { [tx.blockNumber]: true } }, { merge: true })
    }
}

const updateBalance = async (firebase, address) => {
    let getBalance = await web3.eth.getBalance(address)
    let balance = web3.utils.fromWei(getBalance, 'ether')

    let ztxBalance
    try {
        let abiArray = require('../../routes/transaction/ERC20ABI')
        let contract = new web3.eth.Contract(abiArray, ZTXContractAddress)

        let getZtxBalance = await contract.methods.balanceOf(address).call()
        ztxBalance = web3.utils.fromWei(getZtxBalance, 'ether')
    } catch (e) {
        // ignore ztx balance update errors.
    }

    let currencies = {
        currencies: {
            ether: balance
        }
    }

    if (ztxBalance != null) {
        currencies.currencies.ztx = ztxBalance
    }

    await firebase
        .firestore()
        .collection('wallets')
        .doc(address)
        .set(currencies, { merge: true })
        .then(() => {
            return true
        })
        .catch(() => {
            return false
        })
}

const addTransactionMetadata = async (
    firebase,
    transaction,
    timestamp = Date.now()
) => {
    try {
        let from = transaction.from.toLowerCase()
        let to = transaction.to.toLowerCase()

        const transactionRef = firebase
            .firestore()
            .collection('transactions')
            .doc(transaction.hash)

        let checkReceipt = false
        const getTransactionDoc = await transactionRef.get()

        // if the transaction does not exist in firebase, check the receipt and add our custom metadata to the object
        if (!getTransactionDoc || !getTransactionDoc.exists) {
            checkReceipt = true
            transaction._userInterfaceMockId = uuid.v4()
            // Convert BigNumber values to strings for storage
            transaction.value = transaction.value.toString()
            transaction.gasPrice = transaction.gasPrice.toString()

            // Some simple values for obtaining and filtering data on the client easily.
            transaction._type = 'ETH'
            transaction._parties = { [from]: true, [to]: true } //this is so we can query "from x OR to x"
            transaction._amount = '' + web3.utils.fromWei(transaction.value, 'ether')
            transaction._sender = from
            transaction._recipient = to
            transaction._createdAt = timestamp
            transaction._hash = transaction.hash
        }
        // if the transaction is already in firebase, and the status is pending, check the receipt
        else if (
            getTransactionDoc &&
            getTransactionDoc.exists &&
            getTransactionDoc.data()._status === 'pending' &&
            !getTransactionDoc.data()._airdrop
        ) {
            checkReceipt = true
        }
        // this transaction exists in firebase already, and it has already been set as confirmed or failed
        else {
            return null
        }

        if (checkReceipt) {
            const receipt = await web3.eth.getTransactionReceipt(transaction.hash)
            transaction._status = receipt.status === true ? 'successful' : 'failed'
            transaction._gasUsed = receipt.gasUsed.toString()
        }

        return transaction
    } catch (err) {
        console.error(err)
        await firebase
            .firestore()
            .collection('transactions')
            .doc('_state')
            .set(
                { retryBlocks: { [transaction.blockNumber]: true } },
                { merge: true }
            )

        return null
    }
}

const getZTXTransactions = async (firebase, lastSyncedBlock, currentBlockHeight) => {
    let promises = []

    try {
        const contract = new web3.eth.Contract(
            require('../../routes/transaction/ERC20ABI'),
            ZTXContractAddress
        )
        let pastEvents = await contract.getPastEvents('Transfer', {
            fromBlock: lastSyncedBlock,
            toBlock: currentBlockHeight
        })

        pastEvents.forEach(async tx => {
            try {
                let from = tx.returnValues.from.toLowerCase()
                let to = tx.returnValues.to.toLowerCase()
                let amount = web3.utils.fromWei(tx.returnValues.value, 'ether')
                let blockNumber = tx.blockNumber
                let txHash = tx.transactionHash

                if (from === '0x0000000000000000000000000000000000000000') {
                    return false
                }

                if (
                    (from === airdropExecutorAddress &&
                        to === airdropContractAddress) ||
                    from === airdropContractAddress
                )
                    return

                let blockData = await web3.eth.getBlock(blockNumber)
                if (!blockData) {
                    await firebase
                        .firestore()
                        .collection('transactions')
                        .doc('_state')
                        .set(
                            {
                                retryBlocks: {
                                    [tx.blockNumber]: true
                                }
                            },
                            { merge: true }
                        )
                } else {
                    let blockTimestamp = new Date(
                        blockData.timestamp * 1000
                    ).getTime()

                    let transaction = await web3.eth.getTransaction(txHash)

                    if (
                        (transaction.from.toLowerCase() === airdropExecutorAddress &&
                            transaction.to.toLowerCase() ===
                                airdropContractAddress) ||
                        transaction.from.toLowerCase() === airdropContractAddress
                    )
                        return

                    const receipt = await web3.eth.getTransactionReceipt(txHash)

                    transaction._status =
                        receipt.status === true ? 'successful' : 'failed'
                    transaction._gasUsed = receipt.gasUsed.toString()
                    transaction._type = 'ZTX'
                    transaction._amount = amount
                    transaction._sender = from
                    transaction._recipient = to
                    transaction._parties = {
                        [from]: true,
                        [to]: true
                    } //this is so we can query "from x OR to x"
                    transaction._createdAt = blockTimestamp
                    transaction._hash = transaction.hash
                    transaction._userInterfaceMockId = uuid.v4()

                    promises.push(
                        firebase
                            .firestore()
                            .collection('transactions')
                            .doc(txHash)
                            .set(transaction, { merge: true })
                            .then(() => {
                                if (
                                    to !== ZTXContractAddress &&
                                    to !== airdropContractAddress
                                ) {
                                    if (!addresses[to]) {
                                        addresses[to] = true
                                        updateBalancePromises.push(
                                            updateBalance(firebase, to)
                                        )
                                    }
                                }
                                if (
                                    from !== ZTXContractAddress &&
                                    from !== airdropContractAddress
                                ) {
                                    if (!addresses[from]) {
                                        addresses[from] = true
                                        updateBalancePromises.push(
                                            updateBalance(firebase, from)
                                        )
                                    }
                                }
                            })
                            .catch(err => {
                                return console.error(err)
                            })
                    )
                }
            } catch (err) {
                await firebase
                    .firestore()
                    .collection('transactions')
                    .doc('_state')
                    .set(
                        { retryBlocks: { [tx.blockNumber]: true } },
                        { merge: true }
                    )
            }
        })

        return Promise.all(promises)
    } catch (err) {
        let storeRetryPromises = []
        for (let index = lastSyncedBlock + 1; index <= currentBlockHeight; index++) {
            storeRetryPromises.push(
                firebase
                    .firestore()
                    .collection('transactions')
                    .doc('_state')
                    .set({ retryBlocks: { [index]: true } }, { merge: true })
            )
        }
        return Promise.all(storeRetryPromises)
    }
}
