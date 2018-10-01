const _ = require('lodash')
const firebase = require('firebase-admin')
// #endregion

const network = process.env.CHAIN
const stage = process.env.CURRENT_STAGE

let config = require(`../../config/firebase-${network}-${stage}`)

// #region initialize firebase
firebase.initializeApp(config)

firebase.firestore().settings({ timestampsInSnapshots: true })

module.exports = express => {
    return express.use((request, response, next) => {
        request.injected = _.merge({}, request.injected, { firebase })
        return next()
    })
}
