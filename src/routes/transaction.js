const router = require('express').Router({ mergeParams: true })
const routes = require('./transaction/index')

routes.forEach(route => {
    router.post(route.path, route.method)
})

module.exports = parent => {
    parent.use('/transaction', router)
}
