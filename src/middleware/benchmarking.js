module.exports = express => {
    return express.use((request, response, next) => {
        request.__startedAt = Date.now()

        response.on('finish', () => {
            let elapsed = Date.now() - request.__startedAt
            if (elapsed > 10) {
                console.log(`Request to ${request.url} took ${elapsed}ms`)
            }
        })
        return next()
    })
}
