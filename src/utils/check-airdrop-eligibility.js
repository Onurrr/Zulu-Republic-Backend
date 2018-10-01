module.exports = (firebase, airdropName, userId, email, phoneNumber) => {
    var state = {
        claimed: false,
        pending: false,
        email: false,
        phone: false
    }

    let key = `${airdropName}_state`

    const write = async () => {
        return firebase
            .firestore()
            .collection('public_user_data')
            .doc(userId)
            .set(
                {
                    [key]: state
                },
                { merge: true }
            )
            .then(() => {
                return true
            })
            .catch(err => {
                return false
            })
    }

    return new Promise((resolve, reject) => {
        firebase
            .firestore()
            .collection('transactions')
            .doc(`${airdropName}_${userId}`)
            .get()
            .then(async doc => {
                try {
                    if (doc.exists) {
                        let data = doc.data()
                        if (data._status == 'successful') {
                            state.claimed = true
                            await write()
                            return resolve(state)
                        }
                        if (data._status == 'pending') {
                            state.pending = true
                            await write()
                            return resolve(state)
                        }
                    }

                    let phoneDoc = await firebase
                        .firestore()
                        .collection('airdrop')
                        .where('phoneNumber', '==', phoneNumber)
                        .where('name', '==', airdropName)
                        .get()

                    let emailDoc = await firebase
                        .firestore()
                        .collection('airdrop')
                        .where('email', '==', email)
                        .where('name', '==', airdropName)
                        .get()

                    phoneDoc.forEach(() => {
                        console.log('Phone in use')
                        state.phone = true
                    })

                    emailDoc.forEach(() => {
                        console.log('Email in use')
                        state.email = true
                    })

                    await write()
                    return resolve(state)
                } catch (e) {
                    return reject(e)
                }
            })
    })
}
