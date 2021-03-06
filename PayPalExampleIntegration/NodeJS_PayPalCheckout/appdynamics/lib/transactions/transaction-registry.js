'use strict';

var url = require('url');
var backendInfoToString = require('../transactions/exit-call').backendInfoToString;

function TransactionRegistry(agent) {
  this.agent = agent;

  this.registeredBTIndex = undefined;
  this.excludedBTIndex = undefined;
  this.registeredBackendIndex = undefined;
  this.resolvedBackendIds = undefined;
}
exports.TransactionRegistry = TransactionRegistry;


TransactionRegistry.prototype.init = function() {
  var self = this;

  self.registeredBTIndex = {};
  self.excludedBTIndex = {};
  self.registeredBackendIndex = {};
  self.resolvedBackendIds = {};

  self.agent.on('configUpdated', function() {
    self.updateRegisteredBTIndex();
    self.updateExcludedBTIndex();
    self.updateRegisteredBackendIndex();
  });
}

TransactionRegistry.prototype.updateRegisteredBTIndex = function() {
  var self = this;

  self.registeredBTIndex = {};

  var config = self.agent.configManager.getConfig();

  if(!config.txInfo || !config.txInfo.registeredBTs) return;
  var registeredBTs = config.txInfo.registeredBTs;

  registeredBTs.forEach(function(registeredBT) {
    if(!registeredBT.btInfo || !registeredBT.btInfo.internalName || !registeredBT.id) return;

    self.registeredBTIndex[registeredBT.btInfo.internalName] = registeredBT;
  });
}


TransactionRegistry.prototype.updateExcludedBTIndex = function() {
  var self = this;

  self.excludedBTIndex = {};

  var config = self.agent.configManager.getConfig();

  if(!config.txInfo || !config.txInfo.blackListedAndExcludedBTs) return;
  var blackListedAndExcludedBTs = config.txInfo.blackListedAndExcludedBTs;

  blackListedAndExcludedBTs.forEach(function(excludedBT) {
    if(!excludedBT.internalName) return;

    self.excludedBTIndex[excludedBT.internalName] = excludedBT;
  });
}

TransactionRegistry.prototype.updateRegisteredBackendIndex = function() {
  var self = this;

  self.registeredBackendIndex = {};

  var config = self.agent.configManager.getConfig();

  if(!config.bckInfo || !config.bckInfo.registeredBackends) return;
  var registeredBackends = config.bckInfo.registeredBackends;

  registeredBackends.forEach(function(entry) {
    if(
      !entry.registeredBackend.exitPointType ||
      !entry.registeredBackend.backendID ||
      !entry.exitCallInfo.exitPointType ||
      !entry.exitCallInfo.identifyingProperties)
    {
      return;
    }

    var identifyingPropertiesMap = {};
    entry.exitCallInfo.identifyingProperties.forEach(function(prop) {
      if(prop.value == null) return;
      identifyingPropertiesMap[prop.name] = prop.value;
    });

    var key =
      backendInfoToString(entry.exitCallInfo.exitPointType, identifyingPropertiesMap);
    self.agent.logger.log("registered backendInfo: " + key);
    self.registeredBackendIndex[key] = entry;

    if(entry.registeredBackend.componentID) {
      self.resolvedBackendIds[entry.registeredBackend.backendID] = entry.registeredBackend.componentID;
    }
  });
}


TransactionRegistry.prototype.isExcludedTransaction = function(transaction) {
  var self = this;

  if(self.excludedBTIndex[transaction.name]) {
    return true;
  }

  return false;
}


TransactionRegistry.prototype.matchTransaction = function(transaction, req) {
  var self = this;

  var parts = url.parse(req.url);

  var registeredBT = self.registeredBTIndex[transaction.name];
  if(registeredBT) {
    transaction.registrationId = registeredBT.id;
    transaction.isAutoDiscovered = true;
  }
  else {
    transaction.registrationId = undefined;
    transaction.isAutoDiscovered = true;
  }
}



TransactionRegistry.prototype.matchBackendCall = function(exitCall) {
  var self = this;

  var exitCallId =
    backendInfoToString(exitCall.exitType, exitCall.identifyingProperties);
  self.agent.logger.log("detected backendInfo: " + exitCallId);
  var registeredBackendEntry = self.registeredBackendIndex[exitCallId];
  if(registeredBackendEntry) {
    exitCall.registrationId = registeredBackendEntry.registeredBackend.backendID;
    exitCall.componentId = registeredBackendEntry.registeredBackend.componentID;
  }
  else {
    exitCall.registrationId = undefined;
    exitCall.componentId = undefined;
  }
}



