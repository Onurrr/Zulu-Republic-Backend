module.exports = async (request, response) => {
    const { firebase, userId, userEmail, credentialExpires } = request.injected

    let responseData = {}

    return Promise.all([
        new Promise((resolve, reject) => {
            firebase
                .firestore()
                .collection('public_user_data')
                .doc(userId)
                .get()
                .then(doc => {
                    responseData.exists = doc.exists
                    return resolve()
                })
                .catch(err => {
                    return reject(err.message || err.toString())
                })
        }),
        new Promise((resolve, reject) => {
            firebase
                .firestore()
                .collection('two_factor')
                .doc(userId)
                .get()
                .then(doc => {
                    if (!doc.exists) return resolve()
                    const data = doc.data()
                    if (!data.activated) responseData.twoFactorRequired = false
                    if (
                        data.activated &&
                        credentialExpires != data.credentialExpires
                    )
                        responseData.twoFactorRequired = true
                    return resolve()
                })
                .catch(err => {
                    return reject(err.message || err.toString())
                })
        })
    ])
        .then(async () => {
            if (!responseData.exists) {
                // create user
                await firebase
                    .firestore()
                    .collection('public_user_data')
                    .doc(userId)
                    .set({
                        email: userEmail,
                        createdAt: Date.now(),
                        updateFlags: {
                            accountRecoveryWPK: { updateIndex: 0, completed: true }
                        },
                        airdrop_state: {
                            claimed: false,
                            pending: false,
                            email: false,
                            phoneNumber: false
                        }
                    })
            }

            return response.submit(true, responseData)
        })
        .catch(err => {
            return response.submit(false, err.message || err)
        })
}
