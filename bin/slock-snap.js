#!bin/node

require('../src/config.js').start(process.argv[2]||'lib/node_modules/slock/conf/config_snap.json');
