'use strict';

var util = require('util');
var os = require('os');
var fs = require('fs');
var path = require('path');
var zmq = require('../../thirdparty/zmq');
var Schema = require('../../thirdparty/protobuf').Schema;
var ProtobufModel = require('./protobuf-model').ProtobufModel;


function ProxyTransport(agent) {
  this.agent = agent;

  this.schema = undefined;
  this.configSock = undefined;
  this.reportingSocket = undefined;
  this.infoSocket = undefined;

  this.protobufModel = undefined;
}
exports.ProxyTransport = ProxyTransport;


ProxyTransport.prototype.init = function() {
  var self = this;

  self.protobufModel = new ProtobufModel(self.agent);
  self.protobufModel.init();

  self.nextMessageId = 0;
  self.transactionMap = {};

  self.agent.on('proxyStarted', function(nodeIndex) {
    try {
      self.start(nodeIndex);
    }
    catch(err) {
      self.agent.logger.error(err);
    }
  });
}


ProxyTransport.prototype.cleanupTransactionMap = function() {
  var self = this;

  var minTs = Date.now() - 10000;
  for(var requestId in self.transactionMap) {
    var transaction = self.transactionMap[requestId];
    if(transaction.ts < minTs) {
      delete self.transactionMap[requestId];
    }
  }
}


ProxyTransport.prototype.start = function(nodeIndex) {
  var self = this;

  // proxy communication directory for zmq
  var opts = self.agent.opts;
  //var proxyCommDir = self.agent.tmpDir + '/proxy/' + nodeIndex;
  var proxyCommDir = self.agent.tmpDir + '/proxy/' + opts.applicationName + '/' + opts.tierName +  '/' + nodeIndex;


  // init transport and response listeners
  self.schema = new Schema(fs.readFileSync(path.join(__dirname, '../..', 'conf/protobuf.desc')));
  self.ASyncRequest = self.schema['appdynamics.pb.ASyncRequest'];
  self.ConfigResponse = self.schema['appdynamics.pb.ConfigResponse'];
  self.BTInfoRequest = self.schema['appdynamics.pb.BTInfoRequest'];
  self.BTInfoResponse = self.schema['appdynamics.pb.BTInfoResponse'];
  self.ASyncMessage = self.schema['appdynamics.pb.ASyncMessage'];

  self.configSocket = zmq.socket('router');
  self.configSocket.connect('ipc://' + proxyCommDir + '/0');
  self.configSocket.on('message', function(envelope, empty, part1) {
    self.agent.logger.log('config response message received from proxy');
    self.receiveConfigResponse(part1);
  });
  self.configSocket.on('error', function(err) {
    self.agent.logger.error(err);
  });

  self.infoSocket = zmq.socket('router');
  self.infoSocket.connect('ipc://' + proxyCommDir + '/0');
  self.infoSocket.on('message', function(envelope, empty, part1) {
    self.agent.logger.log('info response message received from proxy');
    self.receiveBTInfoResponse(part1);
  });
  self.infoSocket.on('error', function(err) {
    self.agent.logger.error(err);
  });

  self.reportingSocket = zmq.socket('pub');
  self.reportingSocket.connect('ipc://' + proxyCommDir + '/1');
  self.reportingSocket.on('error', function(err) {
    self.agent.logger.error(err);
  });

  // send on connection, do not wait
  self.agent.timers.setTimeout(function() {
    self.sendConfigRequest();
  }, 2000);

  // should we also reqest config after registering unregistered?
  self.agent.timers.setInterval(function() {
    self.sendConfigRequest();
  }, 30000);

  // send on connection, do not wait
  self.agent.timers.setInterval(function() {
    self.cleanupTransactionMap();
  }, 10000);
}


ProxyTransport.prototype.sendConfigRequest = function() {
  var self = this;

  var lastConfigVersion = self.agent.configManager.getConfigVersion();

  var asyncRequestObj = {
    type: 'CONFIG',
    configReq: {
      lastVersion: lastConfigVersion
    }
  };

  try {
    var asyncRequestBytes = self.ASyncRequest.serialize(asyncRequestObj);

    self.configSocket.send([
      "AsyncReqRouter",
      "",
      asyncRequestBytes
    ]);
  }
  catch(err) {
    self.agent.logger.error(err);
  }
}


ProxyTransport.prototype.receiveConfigResponse = function(payload) {
  var self = this;

  var configResponseObj = self.ConfigResponse.parse(payload);
  self.agent.logger.log(util.inspect(configResponseObj, {depth: 20}));

  self.agent.configManager.updateConfig(configResponseObj);

  if(configResponseObj.processCallGraphReq) {
    self.protobufModel.createProcessSnapshot(configResponseObj.processCallGraphReq, function(err, processSnapshot) {
      if(err) {
        self.agent.logger.error(err);
      }
      else {
        self.sendProcessSnapshot(processSnapshot);
      }
    });
  }
}



ProxyTransport.prototype.sendBTInfoRequest = function(transaction) {
  var self = this;

  var btInfoRequest = {
    requestID: transaction.id.toString(),
    messageID: 0,
    btIdentifier: self.protobufModel.createBTIdentifier(transaction),
    correlation: self.protobufModel.createCorrelation(transaction)
  };

  // assign transaction to message id in order to find it when info response is received
  transaction.btInfoRequest = btInfoRequest;
  self.transactionMap[btInfoRequest.requestID] = transaction;


  // send to proxy
  var asyncRequestObj = {
    type: 'BTINFO',
    btInfoReq: btInfoRequest
  };


  try {
    var asyncRequestBytes = self.ASyncRequest.serialize(asyncRequestObj);

    self.infoSocket.send([
      "AsyncReqRouter",
      "",
      asyncRequestBytes
    ]);
  }
  catch(err) {
    self.agent.logger.error(err);
  }
}


ProxyTransport.prototype.receiveBTInfoResponse = function(payload) {
  var self = this;

  var btInfoResponse = self.BTInfoResponse.parse(payload);
  self.agent.logger.log("btInfoResponse");
  self.agent.logger.log(btInfoResponse);

  if(btInfoResponse.processCallGraphReq) {
    self.protobufModel.createProcessSnapshot(btInfoResponse.processCallGraphReq, function(err, processSnapshot) {
      if(err) {
        self.agent.logger.error(err);
      }
      else {
        self.sendProcessSnapshot(processSnapshot);
      }
    });
  }

  var transaction = self.transactionMap[btInfoResponse.requestID];
  if(transaction) {
    delete self.transactionMap[btInfoResponse.requestID];

    if(transaction.isSent) {
      return;
    }

    transaction.btInfoResponse = btInfoResponse;
    transaction.emit('btInfoResponse');

    // if transaction has finished
    if(transaction.ms !== undefined) {
      self.sendTransactionDetails(transaction);
    }
  }
}



ProxyTransport.prototype.sendTransactionDetails = function(transaction) {
  var self = this;

  // in case no BTInfoResponse received yet, wait for 10ms
  if(!transaction.btInfoResponse && !transaction.hasWaitedForBTInfoResponse) {
    self.agent.logger.log('waiting for btInfoResponse');

    self.agent.timers.setTimeout(function() {
      transaction.hasWaitedForBTInfoResponse = true;
      self.sendTransactionDetails(transaction);
    }, 10);

    return;
  }

  if(transaction.isSent) {
    self.agent.logger.log('Transaction has already been sent. Name: ' + transaction.name);
    return;
  }
  transaction.isSent = true;


  var messageObj = {
    type: 'BTDETAILS',
    btDetails: self.protobufModel.createBTDetails(transaction)
  };

  try {
    var asyncMessageBytes = self.ASyncMessage.serialize(messageObj);
    self.agent.logger.log('BTDetails payload');
    self.agent.logger.log(util.inspect(self.ASyncMessage.parse(asyncMessageBytes), {depth: 20}))

    self.reportingSocket.send(asyncMessageBytes);
  }
  catch(err) {
    self.agent.logger.error(err);
  }
}



ProxyTransport.prototype.sendSelfReResolution = function(selfReResolution) {
  var self = this;

  var messageObj = {
    type: 'SELFRERESOLUTION',
    selfReResolution: selfReResolution
  };

  try {
    var asyncMessageBytes = self.ASyncMessage.serialize(messageObj);
    self.agent.logger.log('SelfReResolution payload');
    self.agent.logger.log(util.inspect(self.ASyncMessage.parse(asyncMessageBytes), {depth: 20}))

    self.reportingSocket.send(asyncMessageBytes);
  }
  catch(err) {
    self.agent.logger.error(err);
  }
}


ProxyTransport.prototype.sendProcessSnapshot = function(processSnapshot) {
  var self = this;

  var messageObj = {
    type: 'PROCESSSNAPSHOT',
    processSnapshot: processSnapshot
  };

  try {
    var asyncMessageBytes = self.ASyncMessage.serialize(messageObj);
    self.agent.logger.log('ProcessSnapshot payload');
    self.agent.logger.log(util.inspect(self.ASyncMessage.parse(asyncMessageBytes), {depth: 20}))

    self.reportingSocket.send(asyncMessageBytes);
  }
  catch(err) {
    self.agent.logger.error(err);
  }
}

