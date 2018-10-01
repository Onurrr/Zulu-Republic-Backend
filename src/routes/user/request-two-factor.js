const e164 = require('e164')
const genTwoFactorCode = require('server/utils/generate-two-factor-code')
const sendTextMessage = require('server/utils/send-text-message')

module.exports = async (request, response) => {
    const { userId, firebase } = request.injected
    const { type } = request.body

    if (!type) {
        return response.submit(false, 'MISSING_PARAMS')
    }

    console.log('userId:', userId)
    if (type === 'sms') {
        return firebase
            .firestore()
            .collection('two_factor')
            .doc(userId)
            .get()
            .then(doc => {
                if (!doc.exists) return response.submit(false, '2FA_NOT_ENABLED')
                let data = doc.data()

                let code = genTwoFactorCode()

                return firebase
                    .firestore()
                    .collection('pending_two_factor')
                    .doc(data.phoneNumber)
                    .set({
                        type: 'sms',
                        actionType: 'reauth',
                        textMatch: code,
                        belongsTo: userId,
                        phone: data.phoneNumber,
                        expiresAt: Date.now() + 1000 * 60 * 60
                    })
                    .then(async () => {
                        await firebase
                            .firestore()
                            .collection('two_factor')
                            .doc(userId)
                            .update({
                                attempts: 0
                            })

                        return sendTextMessage(
                            `+${data.phoneNumber}`,
                            `Your two-factor code is: ${code}`
                        )
                            .then(() => {
                                return response.submit(true)
                            })
                            .catch(err => {
                                return response.submit(
                                    false,
                                    err.message || err.toString()
                                )
                            })
                    })
                    .catch(err => {
                        return response.submit(false, err.message || err.toString())
                    })
            })
    } else {
        return response.submit(false, '2FA_TYPE_NOT_SUPPORTED')
    }
}
