const router = require('express').Router({ mergeParams: true })
const rateLimit = require('express-rate-limit')

const routes = require('./user/index')

routes.forEach(route => {
    if (route.throttle) {
        router.post(route.path, rateLimit(route.throttle), route.method)
    } else {
        router.post(route.path, route.method)
    }
})

module.exports = parent => {
    parent.use('/user', router)
}
