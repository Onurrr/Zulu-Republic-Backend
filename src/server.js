// #region imports
const requirePrettify = require('module-alias')
requirePrettify.addAlias('server', __dirname)

const Express = require('express')
const express = Express()
const helmet = require('helmet')
const bodyParser = require('body-parser')
// #endregion

const rootRouter = Express.Router()
rootRouter.route('/').get((request, response) => response.sendStatus(204))
rootRouter.route('/').post((request, response) => response.sendStatus(204))

// #region Setup middleware
express.use(helmet())
express.use(bodyParser.json())
require('server/middleware/benchmarking')(express)
require('server/middleware/cors')(express)
require('server/middleware/inject-firebase')(express)
require('server/middleware/validate-auth-token')(express)
require('server/middleware/check-two-factor')(express)
require('server/middleware/inject-providers')(express)
require('server/middleware/decrypt-private-data')(express)
// #endregion

// #region setup routes
require('server/routes/ethereum')(rootRouter)
require('server/routes/transaction')(rootRouter)
require('server/routes/user')(rootRouter)
// #endregion

const network = process.env.CHAIN
const stage = process.env.CURRENT_STAGE

express.use(`/${network}/${stage}/api/v1`, rootRouter)
express.use('/api/v1', rootRouter)

let port
if (network === 'eth') {
    if (stage === 'development') port = 5000
    if (stage === 'staging') port = 5001
    if (stage === 'production') port = 5002
} else if (network === 'ltc') {
    if (stage === 'development') port = 5003
    if (stage === 'staging') port = 5004
    if (stage === 'production') port = 5005
}

express.listen(port, err => {
    if (err) return console.error('ERROR:', err)
    console.log('Server is listening on port ', port)
})
