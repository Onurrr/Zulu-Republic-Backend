const _ = require('lodash')

const ignoredRoutes = [
    '/api/v1/ethereum/gas-price',
    '/api/v1/user/ensure-exists',
    '/api/v1/user/two-factor/request',
    '/api/v1/user/two-factor/enable',
    '/api/v1/user/two-factor/confirm',
    '/api/v1/user/wallet',
    '/api/v1/user/wallet/reveal-key',

    '/eth/development/api/v1/ethereum/gas-price',
    '/eth/development/api/v1/user/ensure-exists',
    '/eth/development/api/v1/user/two-factor/request',
    '/eth/development/api/v1/user/two-factor/enable',
    '/eth/development/api/v1/user/two-factor/confirm',
    '/eth/development/api/v1/user/wallet',
    '/eth/development/api/v1/user/wallet/reveal-key',

    '/eth/staging/api/v1/ethereum/gas-price',
    '/eth/staging/api/v1/user/ensure-exists',
    '/eth/staging/api/v1/user/two-factor/request',
    '/eth/staging/api/v1/user/two-factor/enable',
    '/eth/staging/api/v1/user/two-factor/confirm',
    '/eth/staging/api/v1/user/wallet',
    '/eth/staging/api/v1/user/wallet/reveal-key',

    '/eth/production/api/v1/ethereum/gas-price',
    '/eth/production/api/v1/user/ensure-exists',
    '/eth/production/api/v1/user/two-factor/request',
    '/eth/production/api/v1/user/two-factor/enable',
    '/eth/production/api/v1/user/two-factor/confirm',
    '/eth/production/api/v1/user/wallet',
    '/eth/production/api/v1/user/wallet/reveal-key'
]

module.exports = express => {
    return express.use((request, response, next) => {
        // Ignore routes that auth is not required for
        if (ignoredRoutes.includes(request.url)) return next()
        console.log('calling check2fa for route:', request.path)

        const { firebase, userId } = request.injected

        return firebase
            .firestore()
            .collection('two_factor')
            .doc(userId)
            .get()
            .then(doc => {
                if (!doc.exists) return next()
                const data = doc.data()
                if (!data.activated) return next()
                if (data.type === 'sms') {
                    if (Date.now() >= (data.credentialExpires || 0)) {
                        return response.submit(false, '2FA_AUTH_REQUIRED')
                    } else {
                        request.injected = _.merge({}, request.injected, {
                            twoFactor: data
                        })
                        return next()
                    }
                } else {
                    // Let the user through, incase we stop supporting a type of 2FA.
                    return next()
                }
            })
            .catch(err => {
                return response.submit(false, err.message || err.toString())
            })
    })
}
