const _ = require('lodash')
const ignoredRoutes = ['/api/v1/ethereum/gas-price']

module.exports = express => {
    return express.use((request, response, next) => {
        // Ignore routes that auth is not required for
        if (ignoredRoutes.includes(request.url)) return next()

        const { firebase } = request.injected
        const { authorization } = request.headers

        if (!authorization) {
            return response.submit('Authorization header not sent with request.')
        }

        if (!authorization.startsWith('Bearer ')) {
            return response.submit(
                false,
                'Invalid authorization header sent with request.'
            )
        }

        const token = authorization.split('Bearer ')[1]

        return firebase
            .auth()
            .verifyIdToken(token)
            .then(decodedToken => {
                request.injected = _.merge({}, request.injected, {
                    userId: decodedToken.uid,
                    userEmail: decodedToken.email,
                    credentialExpires: decodedToken.exp * 1000
                })
                return next()
            })
            .catch(err => {
                console.log('Error', err)
                return response.submit(false, err.message || err.toString())
            })
    })
}
