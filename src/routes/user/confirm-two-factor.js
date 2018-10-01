module.exports = async (request, response) => {
    const { userId, firebase, credentialExpires } = request.injected
    const { type, code } = request.body

    if (!type || !code) {
        return response.submit(false, 'MISSING_PARAMS')
    }

    try {
        let doc = await firebase
            .firestore()
            .collection('two_factor')
            .doc(userId)
            .get()

        if (!doc.exists) return response.submit(false, '2FA_NOT_ENABLED')
        let data = doc.data()
        if (!data) return response.submit(false, '2FA_NOT_ENABLED')

        if (data.attempts >= 5) return response.submit(false, 'CODE_EXPIRED')

        let pendingDoc = await firebase
            .firestore()
            .collection('pending_two_factor')
            .doc(data.phoneNumber)
            .get()

        if (!pendingDoc.exists) return response.submit(false, '2FA_NOT_READY')
        let pending = pendingDoc.data()

        await firebase
            .firestore()
            .collection('two_factor')
            .doc(userId)
            .update({
                attempts: (isNaN(data.attempts) ? 0 : data.attempts) + 1
            })

        if (pending.textMatch !== `${code}`)
            return response.submit(
                false,
                data.attempts >= 4 ? 'CODE_EXPIRED' : 'CODE_NOT_MATCH'
            )

        let obj = { credentialExpires }
        if (pending.actionType === 'enable') {
            obj.activated = true
        } else if (pending.actionType === 'disable') {
            obj.activated = false
        }

        await firebase
            .firestore()
            .collection('two_factor')
            .doc(userId)
            .set(obj, { merge: true })

        return response.submit(true)
    } catch (err) {
        return response.submit(false, err.message || err.toString())
    }
}
