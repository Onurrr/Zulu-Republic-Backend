module.exports = async (request, response) => {
    const { firebase, userId, provider } = request.injected
    const { address } = request.body

    if (await updateBalance(firebase, provider, address)) {
        response.submit(true)
    } else {
        response.submit(false)
    }
}

const updateBalance = async (firebase, web3, address) => {
    let getBalance = await web3.eth.getBalance(address)
    let balance = web3.utils.fromWei(getBalance, 'ether')

    let ztxBalance
    try {
        let abiArray = require('../transaction/ERC20ABI')
        let contract = new web3.eth.Contract(
            abiArray,
            process.env[`${process.env.CURRENT_STAGE.toUpperCase()}_ZTX_CONTRACT`]
        )

        let getZtxBalance = await contract.methods.balanceOf(address).call()
        ztxBalance = web3.utils.fromWei(getZtxBalance, 'ether')
    } catch (e) {
        console.log('Error getting ZTX balance')
        // ignore ztx balance update errors.
    }

    let currencies = {
        currencies: {
            ether: balance
        }
    }

    if (ztxBalance != null) {
        currencies.currencies.ztx = ztxBalance
    }

    console.log('Currencies:', currencies)

    await firebase
        .firestore()
        .collection('wallets')
        .doc(address.toLowerCase())
        .set(currencies, { merge: true })
        .then(() => {
            return true
        })
        .catch(() => {
            return false
        })
}
