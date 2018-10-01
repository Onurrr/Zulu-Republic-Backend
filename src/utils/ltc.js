const stage = process.env.CURRENT_STAGE

const networkName = stage !== 'development' ? 'mainnet' : 'testnet'
const explorers = require('litecore-explorers')
const litecore = explorers.litecore

const insightPort = stage !== 'development' ? '3001' : '3002'
const insight = new explorers.Insight(
    `http://${process.env.LTC_NODE}:${insightPort}`,
    networkName
)
const insightBackupSubdomain = stage !== 'development' ? 'insight' : 'testnet'
const insightBackup = new explorers.Insight(
    `https://${insightBackupSubdomain}.litecore.io`,
    networkName
)

litecore.Networks.defaultNetwork = litecore.Networks[networkName]

const minConf = 1

module.exports = {
    litecore,
    insight,
    insightBackup,
    minConf
}