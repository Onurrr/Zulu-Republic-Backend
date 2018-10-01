module.exports = () => {
    let code = []
    for (var i = 0; i < 4; i++) {
        code.push(Math.round(Math.random() * 9))
    }
    return code.join('')
}
