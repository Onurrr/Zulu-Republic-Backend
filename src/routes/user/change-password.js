const cryptography = require('server/utils/cryptography')

module.exports = async (request, response) => {
    const { firebase, userId, privateData } = request.injected
    const { newPassword, currentPassword } = request.body

    if (!currentPassword || !newPassword) {
        return response.submit(false, 'MISSING_PARAMS')
    }

    try {
        const keyData = await cryptography.getKeyFromServer('zuluKey')
        await firebase.auth().updateUser(userId, { password: newPassword })
        const encrypt = cryptography.encryptDataOnServer(
            keyData.key,
            newPassword,
            JSON.stringify(privateData)
        )

        await firebase
            .firestore()
            .collection('encrypted_user_data')
            .doc(userId)
            .set({ data: encrypt.value }, { merge: true })

        return response.submit(true)
    } catch (err) {
        return response.submit(false, err.message || err.toString())
    }
}
