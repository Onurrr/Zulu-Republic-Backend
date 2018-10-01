module.exports = express => {
    return express.use((request, response, next) => {
        response.submit = (success, dataOrError = {}, additional) => {
            let obj = { success }
            if (success) obj.data = dataOrError
            else obj.error = dataOrError

            if (!success && additional) {
                obj.data = additional
            }

            return response.send(obj)
        }

        response.header('Access-Control-Allow-Origin', '*')
        response.header(
            'Access-Control-Allow-Methods',
            'GET,PUT,POST,DELETE,OPTIONS'
        )
        response.header(
            'Access-Control-Allow-Headers',
            'Content-type,Accept,Authorization'
        )

        if (request.method === 'OPTIONS') {
            return response.status(200).end()
        }

        return next()
    })
}
