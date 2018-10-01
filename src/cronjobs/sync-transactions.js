module.exports = async (firebase, chain) => {
    if (chain === 'eth') {
        await require('./sync/eth')(firebase)
    }
    else if (chain === 'ltc') {
        await require('./sync/ltc')(firebase)
    }
}