'use strict';

const saito = require('../saito');
const Big = require('big.js');


function Block(app, blkjson="", conf=-1) {

  if (!(this instanceof Block)) {
    return new Block(app, blkjson, conf=-1);
  }

  this.app = app || {};

  /////////////////////////
  // consensus variables //
  /////////////////////////
  this.block                  = {};
  this.block.unixtime         = new Date().getTime();
  this.block.prevhash         = "";    
  this.block.merkle           = "";
  this.block.miner            = "";
  this.block.id               = 1;
  this.block.transactions     = [];
  this.block.burn_fee         = 2.0;  		
  this.block.fee_step         = 0.000165;
  this.block.difficulty       = 0.0;
  this.block.paysplit         = 0.5;
  this.block.treasury         = Big("1000000000.0");
  this.block.coinbase         = Big("0.0");
  this.block.reclaimed        = Big("0.0");
  this.block.paysplit_vote    = 0;     // -1 reduce miner payout
                                       //  0 no change
                                       //  1 increase miner payout
  this.block.segadd	      = [];


  //////////
  // size // (bytes)
  //////////
  this.size                   = 0;


  ////////////////////
  // min and max tx //
  ////////////////////
  this.mintid                 = 0;
  this.maxtid                 = 0;

  ////////////////////////
  // non-consensus vars //
  ////////////////////////
  this.is_valid               = 1;
  this.filename               = "";    // permanent filename on disk
  this.hash                   = "";
  this.transactions           = [];    // objects
  this.confirmations          = conf;  // confirmations
  this.prevalidated           = 0;     // set to 1 to forceAdd to blockchain
				       // without running callbacks


  ///////////////
  // callbacks //
  ///////////////
  this.callbacks                     = [];
  this.callbacksTx                   = [];


  ///////////////
  // reference //
  ///////////////
  this.average_fee                   = null;


  /////////////////////////
  // segmented addresses //
  /////////////////////////
  this.segadd_max		     = 0;
  this.segadd_map		     = [];
  this.segadd_enabled		     = 1;
  this.segadd_compression	     = 0;


  /////////////////////
  // reindexing vars //
  /////////////////////
  this.saveBlockId = -1;
  this.saveDatabaseId = -1;


  if (blkjson != "") {
    try {
      this.block = JSON.parse(blkjson.toString("utf8"));
      for (var i = 0; i < this.block.transactions.length; i++) {
        this.transactions[i] = new saito.transaction(this.block.transactions[i]);
        if (this.transactions[i].is_valid == 0) { 
	  this.is_valid = 0;
	  return;
	}
      }
    } catch (err) {
      this.is_valid = 0;
      return;
    }
  }

  return this;

}
module.exports = Block;


Block.prototype.addTransaction = function addTransaction(tx) {
  this.block.transactions.push(JSON.stringify(tx));
  this.transactions.push(tx);
}
// when we add teh callbacks, we have to decide whether there
// is a decrypted msg field we use instead of the default encrypted
// or basic one
Block.prototype.affixCallbacks = function affixCallbacks() {
  for (var z = 0; z < this.transactions.length; z++) {
    var txmsg = this.transactions[z].returnMessage();
    this.app.modules.affixCallbacks(z, txmsg, this.callbacks, this.callbacksTx, this.app);
  }
}

Block.prototype.bundleBlock = function bundleBlock(prevblock=null) {

  //////////////////
  // sanity check //
  //////////////////
  if (this.app.blockchain.currently_indexing == 1 && this.app.blockchain.currently_reclaiming == 1 && this.app.mempool.currently_clearing == 1) { 
    console.log("block.js -- busy and refusing to create block: "+this.app.blockchain.currently_indexing + "/" + this.app.blockchain.currently_reclaiming + " / " + this.app.mempool.currently_clearing);
    return 0; 
  }

  /////////////////
  // alphabetize //
  /////////////////
  this.transactions.sort();

  ///////////////////////////
  // seequential block IDs //
  ////////////////////////////
  if (prevblock == null) {
    this.block.id = 1;
  } else {
    this.block.id = prevblock.block.id+1;
  }

  ////////////////////////////////
  // sequential transaction IDs //
  ////////////////////////////////
  var mtid = 0;
  if (prevblock != null) { mtid = prevblock.returnMaxTxId(); }
  for (i = 0; i < this.transactions.length; i++) {
    mtid++;
    this.transactions[i].transaction.id = mtid;
  }

  /////////////////////////////
  // insert transaction json // 
  /////////////////////////////
  for (var i = 0; i < this.transactions.length; i++) {
    this.block.transactions[i] = this.transactions[i].returnTransactionJson();
  }


  ////////////////////////
  // set default values //
  ////////////////////////
  if (this.transactions.length == 0) { 
    this.block.merkle     = "";
  } else {
    this.block.merkle     = this.app.crypt.returnMerkleTree(this.block.transactions).root;
  }
  this.block.miner        = this.app.wallet.returnPublicKey();


  if (prevblock != null) {

    var txfees_needed = parseFloat(0.0 + prevblock.returnTransactionFeesNeeded(prevblock.block.prevhash)).toFixed(8);
    var total_revenue = parseFloat(txfees_needed) + parseFloat(prevblock.block.coinbase);
    var miner_share   = parseFloat(total_revenue * prevblock.block.paysplit).toFixed(8);
    var node_share    = (total_revenue - miner_share).toFixed(8);
    if (node_share    < 0)             { node_share = 0; }

    this.block.treasury = Big(prevblock.block.treasury).plus(prevblock.block.reclaimed).minus(Big(miner_share)).minus(Big(node_share)).toFixed(8);

    // TODO
    //
    // WE LEAK SAITO WITH ALL DIVISIONS
    //
    // if the amount leaked is enough to cause the rounding error to remove a Saito token, re-add a Saito token to the coinbase
    //
    this.block.coinbase = Big(this.block.treasury).div(this.app.blockchain.genesis_period).toFixed(8);
 
    this.block.prevhash   = prevblock.returnHash();
    this.block.difficulty = prevblock.returnDifficulty();
    this.block.paysplit   = prevblock.returnPaysplit();
    this.block.burn_fee   = prevblock.returnBurnFee();
    this.block.fee_step   = prevblock.returnFeeStep();
  }

  // consensus variables if genesis block
  if (this.block.id == 1) {
    this.block.prevhash   = "";
    this.block.paysplit   = 0.5;
    this.block.difficulty = 0.1875;
    this.block.coinbase = Big(this.block.treasury).div(this.app.blockchain.genesis_period).toFixed(8);
  }

  ///////////////////
  // paysplit vote //
  ///////////////////
  // 
  // this is set in the mempool when we bundle the block
  // as we need to select the transactions for inclusion
  // which meet our conditions.
  //
  //this.block.paysplit_vote   = this.app.voter.returnPaysplitVote(this.block.paysplit);
  //

  //////////////
  // burn fee //
  //////////////
  var nbf = this.calculateBurnFee(this.block.burn_fee, this.block.fee_step);
  this.block.burn_fee = nbf[0];
  this.block.fee_step = nbf[1];

  /////////////////////
  // monetary policy //
  /////////////////////
  var block_self = this;

  this.calculateReclaimedFunds(function(reclaimed) {  

    ///////////////////////////////////////////
    // lite nodes will not properly set this //
    ///////////////////////////////////////////
    //
    // Big.js number
    //
    block_self.block.reclaimed = reclaimed;

    /////////////////////////////////////
    // add to blockchain and propagate //
    /////////////////////////////////////
    block_self.app.blockchain.validateBlockAndQueueInMempool(block_self, 1);    // 1 = propagate
    block_self.app.mempool.currently_creating = 0;

  });
}
Block.prototype.calculateReclaimedFunds = function calculateReclaimedFunds(mycallback) {

  // lite nodes exit quickly
  if (this.app.SPVMODE == 1) { mycallback(Big(0.0)); return; }

  var eliminated_block = this.returnId() - this.app.blockchain.returnGenesisPeriod() - 1;
  var total_amount_to_add_to_treasury = 0.0;

  if (eliminated_block < 1) {
    mycallback(Big(0.0));
    return;
  } else {

    var block_self = this;

    var sql = "SELECT * FROM blocks WHERE longest_chain = $longest_chain AND block_id = $block_id";
    var params = { $longest_chain : 1, $block_id : eliminated_block }
    block_self.app.storage.queryDatabase(sql, params, function(err, row) {

      if (row == null) {
        console.log("Error handling monetary policy....");
        process.exit(0);
      }   

      var db_id = row.id;
      var bid   = row.block_id;

      var filename = db_id + "-" + bid + ".blk";

      block_self.app.storage.openBlockByFilename(filename, function(storage_self, blk) {

	var unspent_amt = Big(0.0);

	for (var i = 0; i < blk.transactions.length; i++) {

	  //
	  // the TO slips are the ones that may or may
	  // not have been spent, so we check to see if
 	  // they are spent using our hashmap.
	  //
	  for (var ii = 0; ii < blk.transactions[i].transaction.to.length; ii++) {
	    var slip = blk.transactions[i].transaction.to[ii];
	    if (slip.amt > 0) {
	      if (storage_self.isSlipSpent(slip, block_self.returnId()) == 0) {
		if (slip.gt != null || slip.ft != null) {
		  if (slip.bhash == "") {
		    slip.bhash = blk.hash('hex');
	            if (storage_self.isSlipSpent(slip) == 0) {
	              unspent_amt = unspent_amt.plus(Big(slip.amt));
		    } else {
		    }
		  } else {
	            unspent_amt = unspent_amt.plus(Big(slip.amt));
		  }
	        }
	      }
	    }
          }
        }

        var sql2 = "SELECT * FROM blocks WHERE longest_chain = $longest_chain AND block_id = $block_id";
        var params2 = { $longest_chain : 1, $block_id : eliminated_block+1 }
        block_self.app.storage.queryDatabase(sql2, params2, function(err2, row2) {

          if (row2 == null) {
            console.log("Error handling monetary policy....");
            process.exit(0);
          }   

          var db_id2 = row2.id;
          var bid2   = row2.block_id;
          var bgt    = row2.golden_ticket;

          if (bgt == 0) {

            var sql3 = "SELECT * FROM blocks WHERE longest_chain = $longest_chain AND block_id = $block_id";
            var params3 = { $longest_chain : 1, $block_id : eliminated_block }
            block_self.app.storage.queryDatabase(sql3, params3, function(err3, row3) {

              if (row3 == null) {
                console.log("Error handling monetary policy....");
                process.exit(0);
              }   

              var db_id3 = row3.id;
              var bid3   = row3.block_id;

              var filename3 = db_id3 + "-" + bid3 + ".blk";

              block_self.app.storage.openBlockByFilename(filename3, function(storage_self3, blk3) {
	        unspent_amt = unspent_amt.plus(Big(blk3.block.coinbase));
                mycallback(unspent_amt);
	        return;
              });
            });
	  } else {
            mycallback(unspent_amt);
	    return;
          }
	});
      });
    });
  }
}
Block.prototype.calculateBurnFee = function calculateBurnFee(starting_burn_fee, starting_fee_step) {

  var bf    = [];
  bf[0] = parseFloat(starting_burn_fee);
  bf[1] = parseFloat(starting_fee_step);

  var current_unixtime = this.block.unixtime;
  var prevblk_unixtime = this.app.blockchain.returnUnixtime(this.block.prevhash);

  if (prevblk_unixtime == -1) { return bf; }

  var block_time  = current_unixtime - prevblk_unixtime;
  var target_time = this.app.blockchain.heartbeat * 1000;

  // faster than target
  if (target_time > block_time) {

    bf[0] += 0.0001;
    bf[0]  = parseFloat(bf[0]).toFixed(8);
    bf[1]  = bf[0] / (this.app.blockchain.max_heartbeat * 1000);
    bf[1]  = bf[1].toFixed(8);

  } else { if (target_time < block_time) {

    bf[0] -= 0.0001;
    if (bf[0] < 2) { bf[0] = 2.0; }
    bf[0]  = parseFloat(bf[0]).toFixed(8);
    bf[1]  = bf[0] / (this.app.blockchain.max_heartbeat * 1000);
    bf[1]  = bf[1].toFixed(8);

  } }

  return bf;

}
Block.prototype.containsTransactionFor = function containsTransactionFor(publickey) {
  for (var i = 0; i < this.transactions.length; i++) {
    if (this.transactions[i].involvesPublicKey(publickey) == 1) { return 1; }
  }
  return 0;
}
Block.prototype.decryptTransactions = function decryptTransactions() {
  for (var vsd = 0; vsd < this.transactions.length; vsd++) {
    if (this.transactions[vsd].involvesPublicKey(this.app.wallet.returnPublicKey()) == 1) {
      this.transactions[vsd].decryptMessage(this.app);
    }
  }
}
Block.prototype.compressSegAdd = function compressSegAdd() {

  if (this.segadd_enabled == 0) { return; }
  if (this.transactions.length == 0) { return; }

  // process transactions
  for (var i = 0; i < this.transactions.length; i++) {

    // from
    for (var ii = 0; ii < this.transactions[i].transaction.from.length; ii++) {
      if (this.segadd_map[this.transactions[i].transaction.from[ii].add] != null) {
	this.transactions[i].transaction.from[ii].add = "_" + this.segadd_map[this.transactions[i].transaction.from[ii].add];
      } else {
	this.segadd_max++;
	this.segadd_map[this.transactions[i].transaction.from[ii].add] = this.segadd_max-1;
	this.block.segadd[this.segadd_max-1] = this.transactions[i].transaction.from[ii].add;
	this.transactions[i].transaction.from[ii].add = "_" + (this.segadd_max-1);
      }
    }

    // to
    for (var ii = 0; ii < this.transactions[i].transaction.to.length; ii++) {
      if (this.segadd_map[this.transactions[i].transaction.to[ii].add] != null) {
	this.transactions[i].transaction.to[ii].add = "_" + this.segadd_map[this.transactions[i].transaction.to[ii].add];
      } else {
	this.segadd_max++;
	this.segadd_map[this.transactions[i].transaction.to[ii].add] = this.segadd_max-1;
	this.block.segadd[this.segadd_max-1] = this.transactions[i].transaction.to[ii].add;
	this.transactions[i].transaction.to[ii].add = "_" + (this.segadd_max-1);
      }
    }

    // path
    for (var ii = 0; ii < this.transactions[i].transaction.path.length; ii++) {

      if (this.segadd_map[this.transactions[i].transaction.path[ii].to] != null) {
	this.transactions[i].transaction.path[ii].to = "_" + this.segadd_map[this.transactions[i].transaction.path[ii].to];
      } else {
	this.segadd_max++;
	this.segadd_map[this.transactions[i].transaction.path[ii].to] = this.segadd_max-1;
	this.block.segadd[this.segadd_max-1] = this.transactions[i].transaction.path[ii].to;
	this.transactions[i].transaction.path[ii].to = "_" + (this.segadd_max-1);
      }

      if (this.segadd_map[this.transactions[i].transaction.path[ii].from] != null) {
	this.transactions[i].transaction.path[ii].from = "_" + this.segadd_map[this.transactions[i].transaction.path[ii].from];
      } else {
	this.segadd_max++;
	this.segadd_map[this.transactions[i].transaction.path[ii].from] = this.segadd_max-1;
	this.block.segadd[this.segadd_max-1] = this.transactions[i].transaction.path[ii].from;
	this.transactions[i].transaction.path[ii].from = "_" + (this.segadd_max-1);
      }

    }
  }

  this.block.transactions = JSON.stringify(this.transactions, compressSegAddReplacer);
  this.segadd_compression = 1;

}
function compressSegAddReplacer(key,value) {
  if (key == "decrypted_msg") { return undefined; }
  return value;
}
Block.prototype.containsGoldenTicket = function containsGoldenTicket() {

  for (let i = 0; i < this.transactions.length; i++) {
    if (this.transactions[i].isGoldenTicket() == 1) { return 1; }
  }

  return 0;

}
Block.prototype.decompressSegAdd = function decompressSegAdd() {

  if (this.segadd_enabled == 0) { return; }

  // process transactions
  for (var i = 0; i < this.transactions.length; i++) {

    // from
    for (var ii = 0; ii < this.transactions[i].transaction.from.length; ii++) {
      if (this.transactions[i].transaction.from[ii].add.length > 0) {
        if (this.transactions[i].transaction.from[ii].add[0] == "_") {
	  var x = this.transactions[i].transaction.from[ii].add.substring(1);
	  this.transactions[i].transaction.from[ii].add = this.block.segadd[x];
	}
      }
    }

    // to
    for (var ii = 0; ii < this.transactions[i].transaction.to.length; ii++) {
      if (this.transactions[i].transaction.to[ii].add.length > 0) {
        if (this.transactions[i].transaction.to[ii].add[0] == "_") {
	  var x = this.transactions[i].transaction.to[ii].add.substring(1);
	  this.transactions[i].transaction.to[ii].add = this.block.segadd[x];
	}
      }
    }

    // path
    for (var ii = 0; ii < this.transactions[i].transaction.path.length; ii++) {
      if (this.transactions[i].path[ii].transaction.to.length > 0) {
        if (this.transactions[i].transaction.to[ii].add[0] == "_") {
	  var x = this.transactions[i].transaction.to[ii].add.substring(1);
	  this.transactions[i].transaction.to[ii].add = this.block.segadd[x];
	}
      }
      if (this.transactions[i].transaction.path[ii].from.length > 0) {
        if (this.transactions[i].transaction.from[ii].add[0] == "_") {
	  var x = this.transactions[i].transaction.from[ii].add.substring(1);
	  this.transactions[i].transaction.from[ii].add = this.block.segadd[x];
	}
      }
    }

  }

  this.segadd_compression = 0;

}
Block.prototype.importTransaction = function importTransaction(txjson) {
  var tx = new saito.transaction(txjson);
  this.addTransaction(tx);
}
Block.prototype.involvesPublicKey = function involvesPublicKey(publickey) {
  for (var v = 0; v < this.transactions.length; v++) {
    if (this.transactions[v].involvesPublicKey(publickey) == 1) {
      return 1;
    }
  }
  return 0;
}


Block.prototype.returnBlock = function returnBlock() {
  return this.block;
}
Block.prototype.returnBurnFee = function returnBurnFee() {
  return this.block.burn_fee;
}
Block.prototype.returnCoinbase = function returnCoinbase() {
 
  //
  // we cannot convert to a float and then
  // back to a string as that can cause errors
  // in value which cascade due to floating 
  // point issues. 
  //
  // so make sure that the treasury is set 
  // properly and stick with it afterwards
  //
  return this.block.coinbase;
}
Block.prototype.returnDifficulty = function returnDifficulty() {
  return this.block.difficulty;
}
Block.prototype.returnFeeStep = function returnFeeStep() {
  return this.block.fee_step;
}
Block.prototype.returnGoldenTicketContenders = function returnGoldenTicketContenders() {

  var children = [];

  for (var v = 0; v < this.transactions.length; v++) {
    if (this.transactions[v].transaction.path.length == 0) {

      // if there is no path length, the transaction is from us and 
      // we get to add ourselves as a candidate
      children.push(this.transactions[v].transaction.from[0].add);

    } else {

      // otherwise, we pick the destination node in each hop through
      // the transmission path. this eliminates the sender and keeps
      // the focus on nodes that actively transmitted the message    
      for (var x = 0; x < this.transactions[v].transaction.path.length; x++) {
        children.push(this.transactions[v].transaction.path[x].to);
      }
    }
  }
  return children;
}
Block.prototype.returnHash = function returnHash() {
  if (this.hash != "") { return this.hash; }
  this.hash = this.app.crypt.hash( this.returnSignatureSource() );
  return this.hash;
}
Block.prototype.returnId = function returnId() {
  return this.block.id;
}
Block.prototype.returnMaxTxId = function returnMaxTxId() {
  if (this.maxtid != 0) { return this.maxtid; }

  var mti = 0;
  for (var z = 0; z < this.transactions.length; z++) {
    if (this.transactions[z].transaction.id > mti) {
      mti = this.transactions[z].transaction.id;
    }
  }

  this.maxtid = mti;
  return this.maxtid;
}
Block.prototype.returnMinTxId = function returnMinTxId() {
  if (this.mintid != 0) { return this.mintid; }
  if (this.transactions.length == 0) {
    return this.app.blockchain.returnMinTxId();
  };
  var mti = this.transactions[0].transaction.id;
  for (var z = 1; z < this.transactions.length; z++) {
    if (this.transactions[z].transaction.id < mti) {
      mti = this.transactions[z].transaction.id;
    }
  }

  this.mintid = mti;
  return this.mintid;
}
Block.prototype.returnPaysplit = function returnPaysplit() {
  return this.block.paysplit;
}
Block.prototype.returnPaysplitVote = function returnPaysplitVote() {
  return this.block.paysplit_vote;
}
Block.prototype.returnReclaimed = function returnReclaimed() {
  return this.block.reclaimed;
}
Block.prototype.returnSignatureSource = function returnSignatureSource() {

  return this.block.unixtime
	 + this.block.prevhash
	 + this.block.roothash
	 + this.block.miner
	 + this.block.id
	 + this.block.burn_fee
	 + this.block.fee_step
	 + this.block.difficulty
	 + this.block.paysplit
	 + this.block.treasury
	 + this.block.coinbase;

}
Block.prototype.returnSurplusFees = function returnSurplusFees() {

  var unixtime_start = this.app.blockchain.returnUnixtime(this.block.prevhash);
  var unixtime_current = this.block.unixtime;
  var ts_bf = this.returnBurnFee();
  var ts_fs = this.returnFeeStep();

  var transaction_fees_needed = this.returnTransactionFeesNeeded(unixtime_start, unixtime_current, ts_bf, ts_fs);
  var transaction_fees   = this.returnTransactionFeesUsable();

  return (transaction_fees - transaction_fees_needed);

}
Block.prototype.returnTransactionFeesUsable = function returnTransactionFeesUsable() {
  var total_fees = 0;
  for (var i = 0; i < this.transactions.length; i++) {
    var tmpfee = this.transactions[i].returnFeeUsable();
    if (this.transactions[i].transaction.ft != 1) {
      if (tmpfee > 0) { total_fees = parseFloat(total_fees) + parseFloat(tmpfee); }
    }
  }
  return total_fees;
}
Block.prototype.returnTransactionFeesTotal = function returnTransactionFeesTotal() {
  var total_fees = 0;
  for (var i = 0; i < this.transactions.length; i++) {
    var tmpfee = this.transactions[i].returnFeeTotal();
    if (tmpfee > 0) { total_fees = parseFloat(total_fees) + parseFloat(tmpfee); }
  }
  return total_fees;
}
Block.prototype.returnTransactionFeesNeeded = function returnTransactionFeesNeeded(ts_start, ts_issue, ts_burn_fee, ts_fee_step) {

  var unixtime_original        = ts_start;
  var unixtime_current         = ts_issue;
  var milliseconds_since_block = unixtime_current - unixtime_original;
  var feesneeded = ( ts_burn_fee - (ts_fee_step * milliseconds_since_block) );

  if (feesneeded < 0) { feesneeded = 0; }

  return feesneeded.toFixed(8);

}
Block.prototype.returnTreasury = function returnTreasury() {

  //
  // we cannot convert to a float and then
  // back to a string as that can cause errors
  // in value which cascade due to floating 
  // point issues. 
  //
  // so make sure that the coinbase is set 
  // properly and stick with it afterwards
  //
  return this.block.treasury;
}
Block.prototype.runCallbacks = function runCallbacks(confnum) {
  for (var cc = this.confirmations+1; cc <= confnum; cc++) {
    for (var ztc = 0; ztc < this.callbacks.length; ztc++) {
      this.callbacks[ztc](this, this.transactions[this.callbacksTx[ztc]], cc, this.app);
    }
  }
  this.confirmations = confnum;
}



////////////////
// Validation //
////////////////
Block.prototype.validate = function validate() {

  ////////////////////////
  // check transactions //
  ////////////////////////
  if (this.block.transactions.length != this.transactions.length) {
   console.log("Block transactions do not match. Discarding.");
   return 0;
  }

  /////////////////////////
  // validate merkleTree //
  /////////////////////////
  if (this.block.transactions.length > 0) {
    var t = this.app.crypt.returnMerkleTree(this.block.transactions).root;
    if (t != this.block.merkle) {
      console.log("Block transaction roothash is not as expected");
      return 0;
    }
  }

  ///////////////////
  // validate fees //
  ///////////////////
  if (this.block.transactions.length > 0) {
    if (this.validateTransactionFeesAdequate() == 0) {
      console.log("Block invalid: transaction fees inadequate");
      return 0;
    }
  }

  ////////////////////////////
  // validate golden ticket //
  ////////////////////////////
  if (this.validateGoldenTicket() == 0 && this.app.SPVMODE == 0) {
    console.log("Block invalid: contains invalid golden ticket");
    this.app.mempool.removeGoldenTicket();
    return 0;
  }

  ///////////////////////////
  // validate transactions //
  ///////////////////////////
  var ft_found = 0;
  var gt_found = 0;
  for (var zz = 0; zz < this.transactions.length; zz++) {
    if (this.transactions[zz].validate(this.app, this.block.paysplit_vote, this.block.id) != 1) {
      console.log("Block invalid: contains invalid transaction");
      console.log("hash:  " + this.app.crypt.hash(JSON.stringify(this.transactions[zz])));
      console.log("sig:  " + this.transactions[zz].transaction.sig);
      console.log("msig: " + this.transactions[zz].transaction.msig);
      return 0;
    }
    if (this.transactions[zz].isGoldenTicket() == 1) { gt_found++; }
    if (this.transactions[zz].isFeeTransaction() == 1) { ft_found++; }
    if (ft_found > 1) {
      console.log("Block invalid: contains multiple fee capture transactions");
      return 0;
    }
    if (gt_found > 1) {
      console.log("Block invalid: contains multiple golden ticket transactions");
      return 0;
    }
  }

  ///////////////////////////
  // burn fee and fee step //
  ///////////////////////////
  if (this.block.prevhash != "") {
    var prevblk = this.app.blockchain.returnBlockByHash(this.block.prevhash);
    if (prevblk != null) {
      var newbf = this.calculateBurnFee(prevblk.returnBurnFee(), prevblk.returnFeeStep());
      if (newbf[0] != this.block.burn_fee) {
        console.log("Block invalid: burn fee miscalculated: "+newbf[0]+" versus "+this.block.burn_fee);
        return 0;
      }
      if (newbf[1] != this.block.fee_step) {
        console.log("Block invalid: fee step miscalculated: "+newbf[1]+" versus "+this.block.fee_step);
        return 0;
      }
    }
  }


  return 1;
}
Block.prototype.validateTransactionFeesAdequate = function validateTransactionFeesAdequate() {

  // validate first block
  if (this.block.prevhash == "") { return 1; }
  var tb = this.app.blockchain.returnBlockByHash(this.block.prevhash);
  if (tb == null) { return 1; }

  // otherwise calculate
  var unixtime_start = this.app.blockchain.returnUnixtime(this.block.prevhash);
  var unixtime_current = this.block.unixtime;
  var transaction_fees_needed = this.returnTransactionFeesNeeded(unixtime_start, unixtime_current, tb.returnBurnFee(), tb.returnFeeStep());

  var usable_transaction_fees   = 0;
  for (var i = 0; i < this.block.transactions.length; i++) {
    if (this.transactions[i].transaction.ft != 1) {
      usable_transaction_fees += this.transactions[i].returnFeeUsable();
    }
  }
  if (transaction_fees_needed > usable_transaction_fees) { return 0; }

  return 1;

}
Block.prototype.validateGoldenTicket = function validateGoldenTicket() {

  if (this.app.SPVMODE == 1) { return 1; }

  var prevblk = this.app.blockchain.returnBlockByHash(this.block.prevhash);
  var gtix    = null;


  // first block we receive
  if (prevblk == null && this.app.blockchain.blocks.length <= 1) {
    console.log("Previous Block is NULL -- cannot validate Golden Ticket");
    return 1;
  }


  // check for golden ticket
  var goldenticketcount = 0;
  for (var bli = 0; bli < this.transactions.length; bli++) {
    if (this.transactions[bli].transaction.gt != null) {
      goldenticketcount++;
      gtix = new saito.goldenticket(this.app, JSON.stringify(this.transactions[bli].transaction.gt));
      if (gtix.validate(prevblk, this) == 0) {
	console.log("Block invalid: golden ticket does not validate");
	return 0;
      }
    }
  }

  if (goldenticketcount > 1) {
    console.log("Block invalid: has more than one golden ticket");
    return 0;
  }

  // no golden ticket
  if (gtix == null && prevblk != null) {
    // difficulty, paysplit should be unchanged
    if (this.returnPaysplit() != prevblk.returnPaysplit()) {
      console.log("Block invalid: no golden ticket yet paysplit differs");
      return 0;
    }
    if (this.returnDifficulty() != prevblk.returnDifficulty()) {
      console.log("Block invalid: no golden ticket yet difficulty differs");
      return 0;
    }

    return 1;
  }


  // validate paysplit and difficulty changes, and monetary policy
  if (prevblk != null) {

    // validate paysplit and difficulty
    if (this.returnDifficulty() != gtix.calculateDifficulty(prevblk)) {
      console.log("Block invalid: difficulty adjustment is incorrect");
      return 0;
    }
    if (this.returnPaysplit() != gtix.calculatePaysplit(prevblk)) {
      console.log("Block invalid: paysplit adjustment is incorrect");
      return 0;
    }

    // validate monetary policy
    if (gtix != null) {
      if (gtix.validateMonetaryPolicy(this.returnTreasury(), this.returnCoinbase(), prevblk) != 1) {
        console.log("Block invalid: monetary policy does not validate");
        return 0;
      }
    }
  }

  return 1;
}
Block.prototype.validateReclaimedFunds = function validateReclaimedFunds(mycallback) {

  // lite clients exit without validating
  if (this.app.BROWSER == 1 || this.app.SPVMODE == 1) {
    mycallback(1);
    return;
  }

  var block_self = this;

  // full nodes have to check
  this.calculateReclaimedFunds(function(reclaimed) {

    if (Big(reclaimed).eq(reclaimed)) {
      mycallback(1);
      return;
    } else {
      mycallback(0);
      return;
    }
  });

}
Block.prototype.updateConfirmationNumberWithoutCallbacks = function updateConfirmationNumberWithoutCallbacks(confnum) {
  if (confnum > this.confirmations) {this.confirmations = confnum; }
}
Block.prototype.returnAverageFee = function returnAverageFee() {

  if (this.average_fee > 0) { return this.average_fee; }

  var total_fees = 0.0;

  for (var i = 0; i < this.transactions.length; i++) {
    total_fees = this.transactions[i].returnFeeTotal();
  }
  this.average_fee = total_fees / this.transactions.length;

}


