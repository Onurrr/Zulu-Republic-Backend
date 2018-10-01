const ensureExists = require('./ensure-exists')
const revealKey = require('./reveal-key')
const changePassword = require('./change-password')
const changeEmail = require('./change-email')
const enableTwoFactor = require('./enable-two-factor')
const disableTwoFactor = require('./disable-two-factor')
const requestTwoFactor = require('./request-two-factor')
const confirmTwoFactor = require('./confirm-two-factor')
const createWallet = require('./create-wallet')
const requestAirdrop = require('./request-airdrop')
const checkAirdropEligibility = require('./check-airdrop-eligibility')
const checkBalances = require('./check-balances')
const updateSecurity = require('./update-security')
const recoverAccount = require('./recover-account')

module.exports = [
    { path: '/ensure-exists', method: ensureExists },
    { path: '/wallet/reveal-key', method: revealKey },
    { path: '/change-password', method: changePassword },
    { path: '/change-email', method: changeEmail },
    {
        path: '/two-factor/enable',
        method: enableTwoFactor,
        throttle: { windowMs: 5000, max: 1 }
    },
    {
        path: '/two-factor/disable',
        method: disableTwoFactor,
        throttle: { windowMs: 1000, max: 1 }
    },
    {
        path: '/two-factor/request',
        method: requestTwoFactor,
        throttle: { windowMs: 5000, max: 1 }
    },
    {
        path: '/two-factor/confirm',
        method: confirmTwoFactor,
        throttle: { windowMs: 1000, max: 1 }
    },
    {
        path: '/update-security',
        method: updateSecurity
    },
    { path: '/wallet', method: createWallet },
    { path: '/request-airdrop', method: requestAirdrop },
    { path: '/check-airdrop-eligibility', method: checkAirdropEligibility },
    { path: '/get-balance', method: checkBalances },
    { path: '/recover-account', method: recoverAccount }
]

// TODO: two-factor confirm
// TODO: /user/wallet - create
