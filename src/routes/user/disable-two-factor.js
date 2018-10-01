module.exports = async (request, response) => {
    const { userId, firebase } = request.injected
    const { currentPassword } = request.body

    if (!currentPassword) {
        return response.submit(false, 'MISSING_PARAMS')
    }

    return firebase
        .firestore()
        .collection('two_factor')
        .doc(userId)
        .set(
            {
                activated: false,
                credentialExpires: 0,
                attempts: 0
            },
            { merge: true }
        )
        .then(() => {
            return response.submit(true)
        })
        .catch(err => {
            return response.submit(false, err.message || err.toString())
        })
}
