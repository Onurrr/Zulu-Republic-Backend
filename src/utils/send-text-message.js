const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

module.exports = (to, body) => {
    return client.messages.create({
        body,
        to,
        from: process.env.TWILIO_FROM
    })
}
