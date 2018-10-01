module.exports = async (request, response) => {
    const { firebase, userId, userEmail } = request.injected
    const { currentPassword, newEmail } = request.body

    if (!currentPassword || !newEmail) {
        return response.submit(false, 'MISSING_PARAMS')
    }

    let promises = [
        new Promise((resolve, reject) => {
            firebase
                .auth()
                .updateUser(userId, { email: newEmail })
                .then(() => resolve())
                .catch(err => reject('auth'))
        }),
        new Promise((resolve, reject) => {
            firebase
                .firestore()
                .collection('public_user_data')
                .doc(userId)
                .set({ email: newEmail }, { merge: true })
                .then(() => resolve())
                .catch(err => reject('database'))
        })
    ]

    return Promise.all(promises)
        .then(() => {
            return response.submit(true)
        })
        .catch(reason => {
            if (reason == 'firebase') {
                return firebase
                    .auth()
                    .updateUser(userId, { email: userEmail })
                    .then(() => {
                        return response.submit(false, 'Failed to change email')
                    })
            } else if (reason == 'auth') {
                return firebase
                    .firestore()
                    .collection('public_user_data')
                    .doc(userId)
                    .set({ email: userEmail }, { merge: true })
                    .then(() => {
                        return response.submit(false, 'Failed to change email')
                    })
            }
        })
}
