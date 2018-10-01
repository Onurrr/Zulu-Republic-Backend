const e164 = require('e164')
const genTwoFactoCode = require('server/utils/generate-two-factor-code')
const sendTextMessage = require('server/utils/send-text-message')

module.exports = async (request, response) => {
    const { userId, firebase } = request.injected
    const { currentPassword, type, phoneNumber } = request.body

    if (!currentPassword || !type) {
        return response.submit(false, 'MISSING_PARAMS')
    }

    if (type === 'sms') {
        if (!phoneNumber) return response.submit(false, 'MISSING_PARAMS')

        if (!e164.lookup(phoneNumber)) {
            return response.submit(false, 'INVALID_PHONE_NUMBER')
        }

        return firebase
            .firestore()
            .collection('two_factor')
            .doc(userId)
            .set({
                activated: false,
                type: 'sms',
                phoneNumber,
                credentialExpires: 0,
                onLogin: true,
                onTransaction: false,
                attempts: 0
            })
            .then(() => {
                let code = genTwoFactoCode()

                return firebase
                    .firestore()
                    .collection('pending_two_factor')
                    .doc(phoneNumber)
                    .set({
                        type: 'sms',
                        actionType: 'enable',
                        textMatch: code,
                        belongsTo: userId,
                        phone: phoneNumber,
                        expiresAt: Date.now() + 1000 * 60 * 60
                    })
                    .then(() => {
                        return sendTextMessage(
                            `+${phoneNumber}`,
                            `Thank you for enabling two-factor authentication, your code is: ${code}`
                        )
                            .then(() => {
                                return response.submit(true)
                            })
                            .catch(err => {
                                const message = err.message || err.toString()
                                if (message.indexOf('not a valid') !== -1) {
                                    return response.submit(
                                        false,
                                        'INVALID_PHONE_NUMBER'
                                    )
                                }
                                return response.submit(
                                    false,
                                    err.message || err.toString()
                                )
                            })
                    })
                    .catch(err => {
                        const message = err.message || err.toString()
                        return response.submit(false, message)
                    })
            })
    } else {
        return response.submit(false, '2FA_TYPE_NOT_SUPPORTED')
    }
}
