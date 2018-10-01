const cryptography = require('server/utils/cryptography')

module.exports = async (request, response) => {
    const { userId, firebase, privateData } = request.injected
    const { flag, currentPassword } = request.body

    if (!flag || !currentPassword) {
        return response.submit(false, 'MISSING_PARAMS')
    }

    let user = await firebase
        .firestore()
        .collection('public_user_data')
        .doc(userId)
        .get()
    if (!user.exists) return response.submit(false, 'USER_NOT_EXISTS')
    if (
        user.data().updateFlags &&
        user.data().updateFlags[flag] &&
        user.data().updateFlags[flag].completed
    ) {
        return response.submit(false, 'UPDATE_ALREADY_COMPLETE')
    }

    switch (flag) {
        case 'accountRecoveryWPK':
            try {
                console.log('userId', userId)

                let snapshot = await firebase
                    .firestore()
                    .collection('wallets')
                    .where('belongsTo', '==', userId)
                    .where('isDefault', '==', true)
                    .limit(1)
                    .get()

                let defaultAddress =
                    snapshot.docs.length > 0 ? snapshot.docs[0].data().address : null
                if (!defaultAddress)
                    return response.submit(
                        false,
                        'User does not have a default wallet.'
                    )
                let privateKey = privateData[defaultAddress]

                const keyData = await cryptography.getKeyFromServer('zuluKey')
                const encrypt = cryptography.encryptDataOnServer(
                    keyData.key,
                    privateKey,
                    currentPassword
                )

                await firebase
                    .firestore()
                    .collection('encrypted_user_data')
                    .doc(userId)
                    .set({ pass: encrypt.value }, { merge: true })

                await firebase
                    .firestore()
                    .collection('public_user_data')
                    .doc(userId)
                    .set(
                        {
                            updateFlags: {
                                [flag]: { completed: true }
                            }
                        },
                        { merge: true }
                    )

                return response.submit(true)
            } catch (err) {
                return response.submit(false, err.message || err.toString())
            }
    }

    return response.submit(false, 'INVALID_FLAG')
}
