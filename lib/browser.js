var saito = require('./saito');

var app            = {};
    app.BROWSER    = 1;
    app.SPVMODE    = 1;


////////////////////
// Load Variables //
////////////////////
app.crypt      = new saito.crypt();
app.storage    = new saito.storage(app);
app.mempool    = new saito.mempool(app);
app.voter      = new saito.voter(app);
app.wallet     = new saito.wallet(app);
app.miner      = new saito.miner(app);
app.monitor    = new saito.monitor(app);
app.browser    = new saito.browser(app);
app.archives   = new saito.archives(app);
app.dns        = new saito.dns(app);
app.keys       = new saito.keys(app);
app.network    = new saito.network(app);
app.blockchain = new saito.blockchain(app);
app.server     = new saito.server(app);
app.modules    = require('./modules/mods')(app);




////////////////
// Initialize //
////////////////
app.storage.initialize();
app.wallet.initialize();
app.mempool.initialize();
app.blockchain.initialize();
app.keys.initialize();
app.network.initialize();
//
// archives before modules
//
app.archives.initialize();
//
// dns before browser so modules can 
// initialize with dns support
//
app.dns.initialize();
//
// modules pre-initialized before
// browser, so that the browser
// can check which application we
// are viewing.
//
app.modules.pre_initialize();
app.browser.initialize();
app.modules.initialize();
//
// server initialized after modules
// so that the modules can use the
// server to feed their own subpages
// as necessary
//
app.server.initialize();


console.log('\
\n\
\n\
Welcome to Saito \n\
\n\
address: ' + app.wallet.returnPublicKey() + '\n\
balance: ' + app.wallet.returnBalance() + '\n\
\n\n\
Want a job that matters? Get in touch: info@saito.tech \n\
\n\n');


/////////////////////
// Cntl-C to Close //
/////////////////////
process.on('SIGTERM', function () {
  app.server.close();
  app.network.close();
  console.log("Network Shutdown");
});
process.on('SIGINT', function () {
  app.server.close();
  app.network.close();
  console.log("Network Shutdown");
});



