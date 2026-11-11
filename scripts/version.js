// Reads version.properties (the single source of the app version) for the Node scripts.
'use strict';
const fs = require('fs'), path = require('path');
const text = fs.readFileSync(path.join(__dirname, '..', 'version.properties'), 'utf8');
const get = k => { const m = text.match(new RegExp('^' + k + '=(.+)$', 'm')); if (!m) throw new Error('version.properties: ' + k + ' missing'); return m[1].trim(); };
module.exports = { name: get('VERSION_NAME'), code: parseInt(get('VERSION_CODE'), 10) };
