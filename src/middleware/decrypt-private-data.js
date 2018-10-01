const _ = require('lodash')
const cryptography = require('server/utils/cryptography')
const checkPassword = require('server/utils/check-password')

module.exports = express => {
    return express.use(async (request, response, next) => {
        const { currentPassword } = request.body
        const { firebase, userId, userEmail, chain } = request.injected

        if (!currentPassword) return next()

        try {
            await checkPassword(chain, userEmail, currentPassword)
        } catch (err) {
            return response.submit(false, 'INVALID_PASSWORD')
        }

        return firebase
            .firestore()
            .collection('encrypted_user_data')
            .doc(userId)
            .get()
            .then(doc => {
                if (!doc.exists) {
                    request.injected = _.merge({}, request.injected, {
                        privateData: {}
                    })
                    return next()
                }

                const encryptedData = doc.data()

                return cryptography
                    .getKeyFromServer('zuluKey')
                    .then(result => {
                        const serverKey = result.key

                        let decryptUserData = cryptography.decryptDataOnServer(
                            serverKey,
                            currentPassword,
                            encryptedData.data
                        )

                        if (!decryptUserData.success)
                            return response.submit(false, decryptUserData.error)

                        request.injected = _.merge({}, request.injected, {
                            privateData: JSON.parse(decryptUserData.value)
                        })

                        return next()
                    })
                    .catch(err => {
                        return response.submit(false, err.message || err.toString())
                    })
            })
            .catch(err => {
                return response.submit(false, err.message || err.toString())
            })
    })
}
