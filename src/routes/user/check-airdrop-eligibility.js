const checkAirdropEligibility = require('server/utils/check-airdrop-eligibility')

module.exports = async (request, response) => {
    const { userId, userEmail, twoFactor, chain, firebase } = request.injected
    if (chain !== 'eth') return response.submit(false, 'NOT_IMPLEMENTED')
    if (!twoFactor || !twoFactor.activated)
        return response.submit(false, '2FA_NOT_ENABLED')
    const { phoneNumber } = twoFactor

    let eligibility = await checkAirdropEligibility(
        firebase,
        'airdropLaunch',
        userId,
        userEmail,
        phoneNumber
    )

    const { claimed, pending, email, phone } = eligibility
    if (claimed || pending || email || phone)
        return response.submit(false, 'DOES_NOT_QUALIFY', eligibility)
    return response.submit(true)
}
