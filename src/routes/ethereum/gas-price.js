module.exports = async (request, response) => {
    const { provider } = request.injected

    return response.submit(true, {
        price: provider.utils.fromWei(
            `${provider.utils.toWei('42', 'gwei') * 21000}`
        )
    })
}
