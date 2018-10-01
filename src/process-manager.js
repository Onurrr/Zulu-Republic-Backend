require('dotenv').config()
const cmdArgs = require('minimist')(process.argv.slice(2))

if (!cmdArgs.stage)
    throw new Error(
        "You must provide the stage ['production', 'development', 'staging'], e.x: node index --stage development"
    )

if (!cmdArgs.chain)
    throw new Error(
        "You must provide the chain ['eth', 'ltc'], e.x: node index --chain ethereum"
    )

if (process.env.CHAIN === 'eth') {
    if (!cmdArgs.encryptionKey) throw new Error('encryption key does not exist.')
}

switch (cmdArgs.stage) {
    case 'development':
    case 'staging':
    case 'production':
        break
    default:
        console.log(
            "Parameter --stage must be one of 'development', 'staging', or 'production'"
        )
        return process.exit(1)
}

switch (cmdArgs.chain) {
    case 'eth':
    case 'ltc':
        break
    default:
        console.log("Parameter --chain must be one of 'eth' or 'ltc'")
        return process.exit(1)
}

process.env.encryption_key = cmdArgs.encryptionKey

const cluster = require('cluster')

if (cluster.isMaster) {
    // TODO: make this dynamic
    process.env.CURRENT_STAGE = cmdArgs.stage
    process.env.CHAIN = cmdArgs.chain

    const availableThreads = require('os').cpus().length

    const createWorker = () => {
        const worker = cluster.fork({ env: process.env })
        worker.on('exit', (code, signal) => {
            if (code !== 0) {
                // TODO: Send some sort of failure alert.
                createWorker()
            }
        })
    }

    const firebase = require('firebase-admin')
    const network = process.env.CHAIN
    const stage = process.env.CURRENT_STAGE

    let config = require(`../config/firebase-${network}-${stage}`)

    // #region initialize firebase
    firebase.initializeApp(config)
    firebase.firestore().settings({ timestampsInSnapshots: true })

    if (network === 'eth') {
        const cryptography = require('./utils/cryptography')
        firebase
            .firestore()
            .collection('zulu_wallets')
            .doc('data')
            .get()
            .then(async doc => {
                if (!doc.exists) {
                    throw new Error('zulu wallets do not exist for stage:', stage)
                }

                const data = doc.data()
                const encryptedData = data[stage]
                let keyData = await cryptography.getKeyFromServer('zuluKey')
                let decrypt = await cryptography.decryptDataOnServer(
                    keyData.key,
                    process.env.encryption_key,
                    encryptedData
                )
                if (!decrypt.success)
                    throw new Error('Failure decrypting zulu_wallet data')

                process.env[
                    `${process.env.CURRENT_STAGE.toUpperCase()}_AIRDROP_EXECUTOR_KEY`
                ] = decrypt.value

                if (network === 'eth') {
                    const handleAirdrops = require('./cronjobs/process-airdrops')
                    // handleAirdrops(firebase, 'airdropLaunch') // Runs itself recursively.
                }
            })
    }

    const syncJob = require('./cronjobs/sync-transactions')
    setInterval(() => {
        // syncJob(firebase, network)
    }, 1000 * 30)

    for (var thread = 0; thread < 1; thread++) {
        createWorker()
    }
} else {
    require('./server')
}
