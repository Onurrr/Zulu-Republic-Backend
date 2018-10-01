const checkAirdropEligibility = require('server/utils/check-airdrop-eligibility')
const uuid = require('uuid')

module.exports = async (request, response) => {
    const { userId, userEmail, twoFactor, chain, firebase } = request.injected
    if (chain !== 'eth') return response.submit(false, 'NOT_IMPLEMENTED')
    if (!twoFactor || !twoFactor.activated)
        return response.submit(false, '2FA_NOT_ENABLED')
    const { phoneNumber } = twoFactor
    const createdAt = Date.now()

    const airdropName = 'airdropLaunch'

    let eligibility = await checkAirdropEligibility(
        firebase,
        airdropName,
        userId,
        userEmail,
        phoneNumber
    )

    if (process.env.CURRENT_STAGE !== 'development') {
        const { claimed, pending, email, phone } = eligibility
        if (claimed || pending || email || phone)
            return response.submit(false, 'DOES_NOT_QUALIFY', eligibility)
    }

    return firebase
        .firestore()
        .collection('wallets')
        .where('belongsTo', '==', userId)
        .where('isDefault', '==', true)
        .limit(1)
        .get()
        .then(snapshot => {
            if (snapshot.docs.length === 0) {
                return response.submit(
                    false,
                    `No default wallet for user: ${userId}`
                )
            }

            const address = snapshot.docs[0].data().address

            const payload = {
                address,
                email: userEmail,
                phoneNumber,
                createdAt,
                userId,
                hash: null,
                processed: false,
                name: airdropName
            }

            return firebase
                .firestore()
                .collection('public_user_data')
                .doc(userId)
                .set(
                    {
                        [`${airdropName}_state`]: {
                            pending: true
                        }
                    },
                    { merge: true }
                )
                .then(() => {
                    return firebase
                        .firestore()
                        .collection('transactions')
                        .doc(`${airdropName}_${userId}`)
                        .set({
                            _userInterfaceMockId: uuid.v4(),
                            _sender: 'AIRDROP :)',
                            _senderEmail: 'AIRDROP :)',
                            _recipient: address,
                            _recipientEmail: userEmail,
                            _createdAt: Date.now(),
                            _type: 'ZTX',
                            _status: 'pending',
                            _parties: { [address]: true },
                            _amount: 500,
                            _airdrop: true
                        })
                        .then(() => {
                            return firebase
                                .firestore()
                                .collection('airdrop')
                                .add(payload)
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
                            return response.submit(
                                false,
                                err.message || err.toString()
                            )
                        })
                })
        })
        .catch(err => {
            return response.submit(false, err.message || err.toString())
        })
}
