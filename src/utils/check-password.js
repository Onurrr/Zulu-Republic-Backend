const axios = require('axios')

const selectFirebaseInstance = chain => {
    let firebaseApiKey
    if (chain === 'eth') {
        if (process.env.CURRENT_STAGE === 'production')
            firebaseApiKey = process.env.FIREBASE_ETH_PRODUCTION_API
        else if (process.env.CURRENT_STAGE === 'staging')
            firebaseApiKey = process.env.FIREBASE_ETH_STAGING_API
        else firebaseApiKey = process.env.FIREBASE_ETH_DEVELOPMENT_API
    } else if (chain === 'ltc') {
        if (process.env.CURRENT_STAGE === 'production')
            firebaseApiKey = process.env.FIREBASE_LTC_PRODUCTION_API
        else firebaseApiKey = process.env.FIREBASE_LTC_DEVELOPMENT_API
    }

    return firebaseApiKey
}

module.exports = (chain, email, password) => {
    let apiKey = selectFirebaseInstance(chain)
    let payload = { email, password, returnSecureToken: true }
    return axios
        .request({
            url: `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${apiKey}`,
            method: 'POST',
            body: payload
        })
        .then(response => {
            return { success: true }
        })
        .catch(err => {
            return { success: false, error: 'INVALID_PASSWORD' }
        })
}
