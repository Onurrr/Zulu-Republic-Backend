const router = require('express').Router({ mergeParams: true })
const routes = require('./ethereum/index')

routes.forEach(route => {
    router.post(route.path, route.method)
})

module.exports = parent => {
    parent.use('/ethereum', router)
}
