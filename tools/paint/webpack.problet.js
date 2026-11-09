// Сборка редактора svg: берём настройки scratch-paint (babel, css-модули, картинки) и меняем точку входа и результат
const path = require('path');
const cfg = require('./webpack.config.js')[0];
cfg.mode = 'production';
cfg.devtool = false;
cfg.devServer = undefined;
cfg.entry = {svgedit: './src/problet/entry.jsx'};
cfg.output = {path: process.env.OUT || path.resolve(__dirname, 'out'), filename: '[name].js'};
cfg.plugins = [];
cfg.performance = {hints: false};
module.exports = cfg;
