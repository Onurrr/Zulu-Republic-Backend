const cryptography = require('server/utils/cryptography')

module.exports = async (request, response) => {
    const { firebase } = request.injected
    const { email, newPassword, privateKey } = request.body

    if (!email || !privateKey || !newPassword) {
        return response.submit(false, 'MISSING_PARAMS')
    }

    try {
        let userResults = await firebase
            .firestore()
            .collection('public_user_data')
            .where('email', '==', email.toLowerCase())
            .limit(1)
            .get()
        let userId = userResults.docs.length > 0 ? userResults.docs[0].id : null
        if (!userId) return response.submit(false, 'USER_NOT_EXISTS')

        let privateDoc = await firebase
            .firestore()
            .collection('encrypted_user_data')
            .doc(userId)
            .get()
        if (!privateDoc.exists)
            return response.submit(
                false,
                'Can not recover an account that does not have an existing wallet. '
            )
        let doc = privateDoc.data()
        let encryptedData = doc.data
        let encryptedPassword = doc.pass

        let encryptionKey = (await cryptography.getKeyFromServer('zuluKey')).key

        let decryptPass = cryptography.decryptDataOnServer(
            encryptionKey,
            privateKey,
            encryptedPassword
        )

        if (!decryptPass.success) return response.submit(false, decryptPass.error)
        let currentPassword = decryptPass.value

        let decryptData = cryptography.decryptDataOnServer(
            encryptionKey,
            currentPassword,
            encryptedData
        )

        if (!decryptData.success) return response.submit(false, decryptData.error)
        let privateData = JSON.parse(decryptData.value)

        let encryptData = cryptography.encryptDataOnServer(
            encryptionKey,
            newPassword,
            JSON.stringify(privateData)
        )

        if (!encryptData.success) return response.submit(false, encryptData.error)
        let reEncryptedData = encryptData.value

        let encryptPassword = cryptography.encryptDataOnServer(
            encryptionKey,
            privateKey,
            newPassword
        )

        if (!encryptPassword.success)
            return response.submit(false, encryptPassword.error)
        let reEncryptedPassword = encryptPassword.value

        // Private key has decrypted the old password, and we have re-encrypted the user data
        // with the new password and re-encrypted the new password with the private key.
        // So now we can start making auth changes.
        await firebase.auth().updateUser(userId, { password: newPassword })
        await firebase
            .firestore()
            .collection('encrypted_user_data')
            .doc(userId)
            .set({
                data: reEncryptedData,
                pass: reEncryptedPassword
            })

        return response.submit(true)
    } catch (e) {
        return response.submit(false, e.message || e.toString())
    }
}
