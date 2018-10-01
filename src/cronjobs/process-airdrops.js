const Web3 = require('web3')

var networkName = 'rinkeby'
if (process.env.CURRENT_STAGE == 'production') networkName = 'mainnet'
if (process.env.CURRENT_STAGE == 'staging') networkName = 'mainnet'

const web3 = new Web3(
    new Web3.providers.HttpProvider(
        `https://${networkName}.infura.io/${process.env.INFURA_API_KEY}`
    )
)

console.log('networkname:', networkName)

const abi = [
    {
        constant: true,
        inputs: [{ name: '', type: 'address' }],
        name: 'claimedAirdropTokens',
        outputs: [{ name: '', type: 'bool' }],
        payable: false,
        stateMutability: 'view',
        type: 'function'
    },
    {
        constant: false,
        inputs: [{ name: 'recipients', type: 'address[]' }],
        name: 'triggerAirDrops',
        outputs: [],
        payable: false,
        stateMutability: 'nonpayable',
        type: 'function'
    },
    {
        constant: false,
        inputs: [],
        name: 'renounceOwnership',
        outputs: [],
        payable: false,
        stateMutability: 'nonpayable',
        type: 'function'
    },
    {
        constant: true,
        inputs: [],
        name: 'tokenAmountPerUser',
        outputs: [{ name: '', type: 'uint256' }],
        payable: false,
        stateMutability: 'view',
        type: 'function'
    },
    {
        constant: true,
        inputs: [],
        name: 'ztx',
        outputs: [{ name: '', type: 'address' }],
        payable: false,
        stateMutability: 'view',
        type: 'function'
    },
    {
        constant: true,
        inputs: [],
        name: 'owner',
        outputs: [{ name: '', type: 'address' }],
        payable: false,
        stateMutability: 'view',
        type: 'function'
    },
    {
        constant: true,
        inputs: [],
        name: 'airdropReceiversLimit',
        outputs: [{ name: '', type: 'uint256' }],
        payable: false,
        stateMutability: 'view',
        type: 'function'
    },
    {
        constant: false,
        inputs: [{ name: 'newZuluOwner', type: 'address' }],
        name: 'kill',
        outputs: [],
        payable: false,
        stateMutability: 'nonpayable',
        type: 'function'
    },
    {
        constant: false,
        inputs: [{ name: 'recipient', type: 'address' }],
        name: 'triggerAirDrop',
        outputs: [],
        payable: false,
        stateMutability: 'nonpayable',
        type: 'function'
    },
    {
        constant: true,
        inputs: [],
        name: 'numOfCitizensWhoReceivedDrops',
        outputs: [{ name: '', type: 'uint256' }],
        payable: false,
        stateMutability: 'view',
        type: 'function'
    },
    {
        constant: false,
        inputs: [{ name: '_newOwner', type: 'address' }],
        name: 'transferOwnership',
        outputs: [],
        payable: false,
        stateMutability: 'nonpayable',
        type: 'function'
    },
    {
        inputs: [
            { name: '_airdropReceiversLimit', type: 'uint256' },
            { name: '_tokenAmountPerUser', type: 'uint256' },
            { name: '_ztx', type: 'address' }
        ],
        payable: false,
        stateMutability: 'nonpayable',
        type: 'constructor'
    },
    {
        anonymous: false,
        inputs: [
            { indexed: true, name: 'receiver', type: 'address' },
            { indexed: false, name: 'amount', type: 'uint256' }
        ],
        name: 'TokenDrop',
        type: 'event'
    },
    {
        anonymous: false,
        inputs: [{ indexed: true, name: 'previousOwner', type: 'address' }],
        name: 'OwnershipRenounced',
        type: 'event'
    },
    {
        anonymous: false,
        inputs: [
            { indexed: true, name: 'previousOwner', type: 'address' },
            { indexed: true, name: 'newOwner', type: 'address' }
        ],
        name: 'OwnershipTransferred',
        type: 'event'
    }
]

var nonce = 0
// Infinitely loop through documents while they don't exist.
// When there's no more documents, check every 5 seconds to see if there's another one.
module.exports = async (firebase, airdropName) => {
    if (
        process.env[
            `${process.env.CURRENT_STAGE.toUpperCase()}_AIRDROP_CONTRACT}`
        ] == 'null'
    )
        return console.error(
            'Failed to start airdrop queue, airdrop contract does not exist for stage.'
        )
    if (
        !process.env[
            `${process.env.CURRENT_STAGE.toUpperCase()}_AIRDROP_EXECUTOR_ADDRESS`
        ] == 'null'
    )
        return console.error(
            'Failed to start airdrop queue, airdrop executor address does not exist for stage.'
        )

    if (
        !process.env[
            `${process.env.CURRENT_STAGE.toUpperCase()}_AIRDROP_EXECUTOR_KEY`
        ] == 'null'
    )
        return console.error(
            'Failed to start airdrop queue, airdrop executor key does not exist for stage.'
        )

    if (!airdropName)
        return console.error('Cannot parse airdrops without a specified name')

    console.log('Starting to parse for:', airdropName)
    fire(firebase, airdropName)
}

const fire = (firebase, airdropName) => {
    return task(firebase, airdropName)
}

const task = async (firebase, airdropName) => {
    let doc = await getQueuedAirdrop(firebase, airdropName)
    console.log('Airdrop exists:', doc.exists)
    if (!doc.exists) {
        await sleep(5000)
        return task(firebase, airdropName)
    } else {
        if (await checkUnique(firebase, airdropName, doc)) {
            try {
                let tx = await processAirdrop(firebase, airdropName, doc)
                await updateBalance(firebase, tx._recipient)

                await firebase.firestore().runTransaction(transaction => {
                    let ref = firebase
                        .firestore()
                        .collection('airdrop')
                        .doc('_state')

                    return transaction.get(ref).then(doc => {
                        let data
                        if (doc.exists) {
                            data = doc.data()
                        }

                        if (!data[`${airdropName}`]) {
                            return
                        }

                        data[`${airdropName}`].claimed =
                            data[`${airdropName}`].claimed + 1
                        return transaction.update(ref, data)
                    })
                })
            } catch (e) {
                let message = e.message || e.toString()

                if (message.indexOf('insufficient funds') !== -1) {
                    console.warn('WARNING: Gas issue with airdrop contract')
                } else if (message.indexOf('nonce too low')) {
                    console.warn('Nonce too low, waiting...')
                    await sleep(5000)
                } else {
                    await doc.ref.delete()
                    await firebase
                        .firestore()
                        .collection('public_user_data')
                        .doc(doc.data().userId)
                        .set(
                            {
                                [`${airdropName}_state`]: {
                                    pending: false
                                }
                            },
                            { merge: true }
                        )
                    await firebase
                        .firestore()
                        .collection('transactions')
                        .doc(`${airdropName}_${doc.data().userId}`)
                        .update({
                            _status: 'failed'
                        })
                }
            }
        } else {
            await doc.ref.delete()
            await firebase
                .firestore()
                .collection('public_user_data')
                .doc(doc.data().userId)
                .set(
                    {
                        [`${airdropName}_claimed`]: {
                            pending: false
                        }
                    },
                    { merge: true }
                )
            await firebase
                .firestore()
                .collection('transactions')
                .doc(`${airdropName}_${doc.data().userId}`)
                .update({
                    _status: 'failed',
                    _error:
                        'Airdrop request was not unique. Please check the Phone# & Email address used.'
                })
        }
        return task(firebase, airdropName)
    }
}

const sleep = millis =>
    new Promise(resolve => {
        setTimeout(() => resolve(), millis)
    })

const getQueuedAirdrop = async (firebase, airdropName) => {
    console.log('Looking for:', airdropName)
    return firebase
        .firestore()
        .collection('airdrop')
        .where('processed', '==', false)
        .where('createdAt', '>=', 0)
        .where('name', '==', airdropName)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get()
        .then(query => {
            if (query.docs.length === 0) return { exists: false }
            return query.docs[0]
        })
        .catch(err => {
            console.error(err)
            return { exists: false }
        })
}

const checkUnique = async (firebase, airdropName, doc) => {
    const { phoneNumber, address, userId, email } = doc.data()

    if (process.env.CURRENT_STAGE === 'development') {
        return true
    }

    let promises = [
        firebase
            .firestore()
            .collection('airdrop')
            .where('phoneNumber', '==', phoneNumber)
            .where('name', '==', airdropName)
            .get(),
        firebase
            .firestore()
            .collection('airdrop')
            .where('userId', '==', userId)
            .where('name', '==', airdropName)
            .get(),
        firebase
            .firestore()
            .collection('airdrop')
            .where('address', '==', address)
            .where('name', '==', airdropName)
            .get(),
        firebase
            .firestore()
            .collection('airdrop')
            .where('email', '==', email)
            .where('name', '==', airdropName)
            .get()
    ]

    return Promise.all(promises)
        .then(results => {
            results.forEach(result => {
                if (result.exists) {
                    return false
                }
            })
            return true
        })
        .catch(err => {
            console.error('Err:', err)
            return false
        })
}

const processAirdrop = (firebase, airdropName, doc) =>
    new Promise(async (resolve, reject) => {
        let data = doc.data()
        let id = doc.id
        let contract = new web3.eth.Contract(
            abi,
            process.env[
                `${process.env.CURRENT_STAGE.toUpperCase()}_AIRDROP_CONTRACT`
            ]
        )

        const userNonce = await web3.eth.getTransactionCount(
            process.env[
                `${process.env.CURRENT_STAGE.toUpperCase()}_AIRDROP_EXECUTOR_ADDRESS`
            ],
            'pending'
        )

        console.log('Debug:', userNonce)
        let tx = {
            from:
                process.env[
                    `${process.env.CURRENT_STAGE.toUpperCase()}_AIRDROP_EXECUTOR_ADDRESS`
                ],
            to:
                process.env[
                    `${process.env.CURRENT_STAGE.toUpperCase()}_AIRDROP_CONTRACT`
                ],
            nonce: web3.utils.toHex(userNonce),
            gasPrice: web3.utils.toWei('21', 'gwei'),
            gasLimit: 250000,
            value: '0x00',
            chainId: process.env.CURRENT_STAGE !== 'development' ? 1 : 4,
            data: contract.methods.triggerAirDrop(data.address).encodeABI()
        }

        console.log('Try to broadcast airdrop')
        let signedTransaction = await web3.eth.accounts.signTransaction(
            tx,
            process.env[
                `${process.env.CURRENT_STAGE.toUpperCase()}_AIRDROP_EXECUTOR_KEY`
            ]
        )

        let rawTransaction = signedTransaction.rawTransaction

        console.log('Raw transaction:', rawTransaction)

        const promiseHack = () => {
            var hash
            return new Promise((resolve, reject) => {
                web3.eth
                    .sendSignedTransaction(rawTransaction)
                    .on('transactionHash', _hash => {
                        hash = _hash
                        doc.ref.update({
                            hash: _hash
                        })
                        console.log('Got a hash:', _hash)
                    })
                    .on('receipt', receipt => {
                        // console.log('Got a receipt:', receipt)
                        return resolve({
                            hash: receipt.transactionHash,
                            status: receipt.status == 1 ? 'successful' : 'failed',
                            gasUsed: receipt.gasUsed.toString()
                        })
                    })
                    .on('error', err => {
                        console.error('Err (onerror):', err)
                        return reject(err)
                    })
                    .on('confirmation', () => {
                        // console.log('Got a confirmation')
                    })
                    .catch(err => {
                        console.error('Err:', err)
                        return reject(err)
                    })
            })
        }

        return promiseHack()
            .then(data => {
                return doc.ref
                    .update({
                        processed: true
                    })
                    .then(() => {
                        return firebase
                            .firestore()
                            .collection('transactions')
                            .doc(`${airdropName}_${doc.data().userId}`)
                            .update({
                                _hash: data.hash,
                                _status: data.status,
                                _gasUsed: data.gasUsed
                            })
                            .then(() => {
                                return firebase
                                    .firestore()
                                    .collection('public_user_data')
                                    .doc(doc.data().userId)
                                    .set(
                                        {
                                            [`${airdropName}_state`]: {
                                                claimed: true,
                                                pending: false
                                            }
                                        },
                                        { merge: true }
                                    )
                                    .then(() => {
                                        return firebase
                                            .firestore()
                                            .collection('transactions')
                                            .doc(
                                                `${airdropName}_${doc.data().userId}`
                                            )
                                            .get()
                                            .then(doc => {
                                                return resolve(doc.data())
                                            })
                                    })
                            })
                            .catch(err => reject(err))
                    })
                    .catch(err => reject(err))
            })
            .catch(err => reject(err))
    })

const updateBalance = async (firebase, address) => {
    let getBalance = await web3.eth.getBalance(address)
    let balance = web3.utils.fromWei(getBalance, 'ether')

    let ztxBalance
    try {
        let abiArray = require('../routes/transaction/ERC20ABI')
        let contract = new web3.eth.Contract(
            abiArray,
            process.env[`${process.env.CURRENT_STAGE.toUpperCase()}_ZTX_CONTRACT`]
        )

        let getZtxBalance = await contract.methods.balanceOf(address).call()
        ztxBalance = web3.utils.fromWei(getZtxBalance, 'ether')
    } catch (e) {
        console.log('Error getting ZTX balance')
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
