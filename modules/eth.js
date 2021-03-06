/// <reference path="../typings/node/node.d.ts"/>

var Web3  = require('web3');
var utils = require('../src/utils.js');

/**
 * a contract which represents a smartContract
 * in the blockchain connected to a device
 */
function Contract(id, config, events, web3) {
  this.config   = config;
  this.id       = id;
  this.events   = events;
  this.web3     = web3;
  this.contract = web3.eth.contract([
    { name: 'Open' , type: 'event', inputs: [], outputs: [] },
    { name: 'Close', type: 'event', inputs: [], outputs: [] },
  ]).at(config.adr);
}

Contract.prototype = {
   config     : {},   // the config from "contracts" in the config.js
   id         : "",   // the key from the "contracts"
   lastOpen   : "",   // remember the last state
   events     : null, // the event-emitter
   contract   : null, // the contract-object in the blockchain
   lastNumber : 0,    // the last number of the event received in order to filter already handled.

   /**
    * triggers the changeState-Event
    * @param isOpen boolean to indicate the targetState
    * @param fromMessage if true this is called after receiving a message
    */
   changeState : function (isOpen, fromMessage) {

      // ignore the trigger if we use messages
      if (this.config.useMessage && !fromMessage)
         return;

      this.events.emit("changeState", {
         open : isOpen,
         id : this.id,
         config : this.config,
         sender : this
      });
   },

   /**
    * called after reveiving a event from the blockchain.
    *
    * It will check if this is a duplictae event and then trigger changeState.
    * @param isOpen targetState
    * @param result the result from the blockchain
    * @param err error-message from last call
    */
   checkEvent : function (isOpen, result, err) {
      if (err) {
         console.log("eth: Error with " + this.id + " :" + err);
         if (this.config.stopOnError && ("" + err).indexOf("INVALID_PARAMS") >= 0) {
            this.events.emit("exit",this);
            process.exit(1);
         }
         return;
      }

      // check last hash (if it is the same event)
      var hash = result.event + "#" + result.hash;
      if (this.lastHash === hash)     return;
      
      this.lastHash   = hash;
      this.lastNumber = result.number;

      // is it already open? -we can ignore it.
      if (!isOpen && !this.lastOpen)  return;

      // trigger
      this.changeState(this.lastOpen = isOpen);
   },

   /**
    * checks if the user sent the message is the one registered or the owner
    * @param user the user
    * @returns {Boolean} true|false
    */
   isAllowed : function (user) {
      return utils.normalizeAdr(this.getCurrentUser()) == utils.normalizeAdr(user) || utils.normalizeAdr(this.getOwner()) == utils.normalizeAdr(user);
   },

   /**
    * checks if the current State in the contract is marked as open
    * @returns {Boolean}
    */
   isStateOpen : function () {
      var open = this.storageIsOpen();
      return open !== "0x" && open !== "0x0";
   },

   /**
    * returns the storage-value of the open-flag
    * @returns
    */
   storageIsOpen : function () {
      return this.web3.eth.getStorageAt(this.config.adr, 4);
   },

   /**
    * returns the current user of the contract
    * @returns
    */
   getCurrentUser : function () {
      return this.web3.eth.getStorageAt(this.config.adr, 3);
   },

   /**
    * returns the current user of the contract
    * @returns
    */
   getOwner : function () {
      return this.web3.eth.getStorageAt(this.config.adr, 0);
   },

   /**
    * reads the storage value and compares it to the last.
    * If it changed, it will trigger changeState
    */
   checkStorage : function () {
      // read openCount
      var open = this.storageIsOpen();
      if (open !== this.lastOpen) {
         this.lastOpen = open;
         this.changeState(open !== "0x" && open !== "0x0");
      }
   },

   /**
    * starts the polling-threads depending on the config
    */
   startWatching : function () {
      console.log("start watching " + this.id);
      var _ = this;
      if (this.config.useStorage)
         this.timer = setInterval(function () { _.checkStorage(); }, (this.config.interval || 1) * 1000);
      else if (!this.config.ignoreEvents) {
         this.openEvent  = this.contract.Open();
         this.closeEvent = this.contract.Close();
         this.openEvent.watch (function (err, result) {  _.checkEvent(true, result, err);   });
         this.closeEvent.watch(function (err, result) {  _.checkEvent(false, result, err);  });
      }

      this.events.emit("watchContract", this);
   },

   /**
    * stops the polling
    */
   stopWatching : function () {
      console.log("stop watching " + this.id);
      if (this.config.useStorage)
         clearInterval(this.timer);
      else if (this.openEvent) {
         this.openEvent.stopWatching();
         this.closeEvent.stopWatching();
      }
   }

};

/**
 * the module with the init-function.
 */
module.exports = function () {
   var contracts = [];

   function handleMessage(msg) {
      contracts.forEach(function (c) {
         if (utils.normalizeAdr(c.config.adr) == utils.normalizeAdr(msg.to) && c.storageIsOpen() && c.isAllowed(msg.from))
            // now send open-event
            c.changeState(msg.msg.indexOf("open") >= 0, true);
      });
   }

   /**
    * initialze or entry-function of the module
    */
   this.init = function (arg) {
      var config = arg.config.modules.eth;
      console.log("Init contracts for client " + config.client);

      // stop if this is a reinit
      if (arg.oldConfig)
         contracts.forEach(function (c) {  c.stopWatching();  });
      else
         arg.events.on("message", handleMessage);
      contracts.length = 0;

      // init the provider
      var web3 = this.web3 = this.web3 || new Web3();
      var events = this.events;
      if (!arg.oldConfig || config.client != arg.oldConfig.modules.eth.client)
         web3.setProvider(new web3.providers.HttpProvider('http://' + config.client));

      // init the contracts
      Object.keys(config.contracts).forEach(function (cid) {
         var c = new Contract(cid, config.contracts[cid], events, web3);
         c.startWatching();
         contracts.push(c);
      });
      
      // add custom command
      arg.events.emit("adminAddCmd", { 
         name    : "contracts",
         comment : "lists all Contracts and their status",
         fnc     : function() {
            var result = "all Contracts: \r\n";
            for (var i = 0; i < contracts.length; i++) {
               var c = contracts[i];
               result+=c.id + ": open= "+c.isStateOpen()+ " + user="+c.getCurrentUser()+" \r\n";
            }
            return result;
         }
      });

      // add custom command
      arg.events.emit("adminAddCmd", { 
         name    : "set",
         comment : "sets the status of a contract: set <DEV> open/close {force}",
         fnc     : function(id,value, force) {
            for (var i = 0; i < contracts.length; i++) {
               var c = contracts[i];
               if (c.id==id) {
                  if (force) 
                     arg.events.emit("changeState", {
                        open : value.indexOf("open")>=0,
                        id : id,
                        config : c.config,
                        sender : this
                     });
                 else
                     arg.events.emit("message", {
                          to     : c.config.adr,
                          "from" : c.getCurrentUser(),
                           msg   : value
                     });
                  return "sent "+value+" event to "+id;
               }
            }
            
            return id+" not found in contracts. See available contracts with 'contracts'";
         }
      });

   }
};
