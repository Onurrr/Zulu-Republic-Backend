const crypto = require('crypto')
const ursa = require('ursa')
const to = require('await-completion')

const getKeyFromServer = (keyName, version = 'current') => {
    return new Promise(resolve => {
        return resolve({
            version: process.env.ENCRYPTION_KVP_VERSION,
            key: Buffer.from(process.env.ENCRYPTION_KVP, 'hex').toString('ascii')
        })
    })
}

/**
 * Generates a new RSA private/public key pair for end-to-end encryption, and puts them into Firebase.
 *
 * @param {Object} network The blockchain network
 */
const generateKeyPair = async network => {
    const key = ursa.generatePrivateKey(1024, 65537)
    const _private = key.toPrivatePem().toString('hex')
    const _public = key.toPublicPem().toString('hex')
    const id = require('uuid').v4()

    await network.firebase
        .firestore()
        .collection('encryption_keys')
        .add({
            private: _private,
            public: _public,
            id,
            createdAt: Date.now()
        })

    return { success: true, data: { public: _public, encryptionPairId: id } }
}

/**
 * Attempts to obtain the private/public key combination from Firebase based on the storageId
 * and then tries to decrypt the data with the found key.
 *
 * @param {String} storageId The id of the key-pair in Firebase.
 * @param {String} data The data in base64 format to be decrypted.
 * @param {Object} network The blockchain network
 *
 */
const decryptDataFromClient = async (storageId, data, network) => {
    const findKey = await to(
        network.firebase
            .firestore()
            .collection('encryption_keys')
            .where('id', '==', storageId)
            .limit(1)
            .get(),
        'result'
    )

    if (!findKey.success) return findKey

    if (findKey.result.size === 0) {
        return {
            success: false,
            error: 'Could not find a RSA key-pair related to the provided storageId.'
        }
    }

    try {
        const privateKey = Buffer.from(
            findKey.result.docs[0].data().private,
            'hex'
        ).toString('ascii')

        const dataBuffer = Buffer.from(data, 'base64')

        const value = crypto.privateDecrypt(privateKey, dataBuffer)

        return { success: true, value }
    } catch (e) {
        return {
            success: false,
            error:
                'There was an error decrypting the provided data from the client. Additional information will be provided if available:' +
                (e.toString ? e.toString() : '')
        }
    }
}

/**
 * Uses a combination of the user's password and a secured private key to encrypt some data
 * in a fashion that can only be decrypted if both the user's password and server's key are present.
 *
 * @param {String} serverPrivateKey The private key data from Secrets Manager
 * @param {String} userPassword The password to encrypt the data with.
 * @param {String} data The data to encrypt
 */
const encryptDataOnServer = (serverPrivateKey, userPassword, data) => {
    try {
        const key = crypto.privateEncrypt(serverPrivateKey, new Buffer(userPassword))
        const base64 = key.toString('base64')

        const cipher = crypto.createCipher('aes-256-cbc', base64)
        const value = cipher.update(data, 'utf8', 'hex') + cipher.final('hex')

        return { success: true, value: value.toString('ascii') }
    } catch (e) {
        return {
            success: false,
            error:
                'There was an error encrypting the provided data on the server. Additional information will be provided if available:' +
                (e.toString ? e.toString() : '')
        }
    }
}

/**
 * Uses a combination of the user's password and a secured private key to decrypt some data
 * encrypted with the #encryptDataOnServer function.
 *
 * @param {String} serverPrivateKey The private key data from Secrets Manager
 * @param {String} userPassword The password to decrypt the data with.
 * @param {String} data The data to decrypt
 */
const decryptDataOnServer = (serverPrivateKey, userPassword, data) => {
    try {
        const key = crypto.privateEncrypt(serverPrivateKey, new Buffer(userPassword))
        const base64 = key.toString('base64')

        const decipher = crypto.createDecipher('aes-256-cbc', base64)
        const value = decipher.update(data, 'hex', 'utf8') + decipher.final('utf8')

        return { success: true, value }
    } catch (e) {
        return {
            success: false,
            error: 'INVALID_PASSWORD'
        }
    }
}

/**
 * Rekeys a user's private data with the current server private key
 *
 * @param {String} legacyKeyVersion The legacy private key version from Firebase
 * @param {String} serverKey The private key data from Secrets Manager
 * @param {String} currentKeyVersion The current private key version from Secrets Manager
 * @param {String} userId
 * @param {String} userPassword The password to decrypt and encrypt the data with.
 * @param {String} data The data to rekey
 * @param {Object} network The blockchain network
 */
const rekeyEncryptedUserData = async (
    legacyKeyVersion,
    serverKey,
    currentKeyVersion,
    userId,
    userPassword,
    data,
    network
) => {
    const fetchKeyFromServer = await to(
        getKeyFromServer('zuluKey'),
        legacyKeyVersion
    )
    if (!fetchKeyFromServer.success) return fetchKeyFromServer
    const legacyPrivateKey = fetchKeyFromServer.data.key

    //decrypt with the key that was used
    let decryptData = decryptDataOnServer(legacyPrivateKey, userPassword, data)
    if (!decryptData.success)
        return {
            success: false,
            error: decryptData.error
        }

    //encrypt with the current key
    let encrypt = encryptDataOnServer(serverKey, userPassword, decryptData.value)
    if (!encrypt.success)
        return {
            success: false,
            error: encrypt.error
        }

    //update the encrypted data with the new value
    let storeEncrypted = await to(
        network.firebase
            .firestore()
            .collection('encrypted_user_data')
            .doc(userId)
            .update({
                data: encrypt.value,
                keyVersion: currentKeyVersion
            })
    )
    if (!storeEncrypted.success) return storeEncrypted

    return { success: true, value: decryptData.value }
}

module.exports = {
    getKeyFromServer,
    generateKeyPair,
    decryptDataFromClient,
    decryptDataOnServer,
    encryptDataOnServer,
    rekeyEncryptedUserData
}
