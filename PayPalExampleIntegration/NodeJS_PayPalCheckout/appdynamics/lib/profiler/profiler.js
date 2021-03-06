'use strict';


var Time = require('../core/time').Time;
var Transaction = require('../transactions/transaction').Transaction;
var ExitCall = require('../transactions/exit-call').ExitCall;

/*
 * Trasaction profiler is responsible for managing the sampling process:
 * finding related operations, emitting exitCalls and providing api
 * for probes to create samples.
 */

function Profiler(agent) {
  this.agent = agent;

  this.transactions = {};
  this.stackTraceFilter = /appdynamics/;
}
exports.Profiler = Profiler;


Profiler.prototype.init = function() {
  var self = this;

  // cleanup transactions
  self.agent.timers.setInterval(function() {
    // expire transactions older than 5 minunes, which have not ended
    var now = Date.now();
    for(var threadId in self.transactions) {
      if(self.transactions[threadId].started + 300000 < now) {
        delete self.transactions[threadId];
      }
    }
  }, 5000);
}


Profiler.prototype.time = function(isTransaction) {
  var t =  new Time(this.agent, isTransaction);
  t.start();

  return t;
};


Profiler.prototype.stackTrace = function(exitCall) {
  if(!exitCall || !exitCall.isSnaphotEnabled) {
    return undefined;
  }

  var err = new Error();
  Error.captureStackTrace(err);

  return this.formatStackTrace(err);
};


Profiler.prototype.formatStackTrace = function(err) {
  var self = this;

  if(err && err.stack) {
    var lines = err.stack.split("\n");
    lines.shift();
    lines = lines.filter(function(line) {
      return !self.stackTraceFilter.exec(line)
    });

    return lines;
  }

  return undefined;
};


Profiler.prototype.startTransaction = function(time, req, entryType) {
  var self = this;

  var transaction = new Transaction();
  transaction.id = time.id;
  transaction.ts = time.begin;
  transaction.threadId = time.threadId;
  transaction.entryType = entryType;

  self.transactions[time.threadId] = transaction;

  try {
    self.agent.emit('transactionStarted', transaction, req);
  }
  catch(err) {
    self.agent.logger.error(err);
  }

  return transaction;
}


Profiler.prototype.endTransaction = function(time, transaction) {
  var self = this;

  transaction.ms = time.ms;

  try {
    self.agent.emit('transaction', transaction);
  }
  catch(err) {
    self.agent.logger.error(err);
  }

  delete this.transactions[time.threadId];
}

Profiler.prototype.getTransaction = function(threadId) {
  var self = this;

  return self.transactions[threadId];
}



Profiler.prototype.createExitCall = function(time) {
  var self = this;

  var exitCall = new ExitCall();

  if(time) {
    var transaction = self.transactions[time.threadId];
    if(transaction) {
      exitCall.sequenceInfo = transaction.exitCallCounter.toString();
      transaction.exitCallCounter++;
    }
  }

  return exitCall;
};


Profiler.prototype.addExitCall = function(time, exitCall) {
  var self = this;

  exitCall.id = time.id;
  exitCall.ts = time.begin;
  exitCall.ms = time.ms;
  exitCall.threadId = time.threadId;

  // if there is a started request, buffer its nested operations
  var transaction = self.transactions[exitCall.threadId];
  if(transaction) {
    if(!transaction.exitCalls) {
      transaction.exitCalls = [];
    }

    exitCall.sequenceInfo = transaction.exitCallCounter.toString();
    transaction.exitCallCounter++;

    transaction.exitCalls.push(exitCall);
  }
};


Profiler.prototype.truncate = function(args) {
  if(!args) return undefined;

  if(typeof args === 'string') {
    return (args.length > 1024 ? (args.substr(0, 1024) + '...') : args);
  }

  if(!args.length) return undefined;

  var arr = [];
  var argsLen = (args.length > 50 ? 50 : args.length);
  for(var i = 0; i < argsLen; i++) {
   if(typeof args[i] === 'string') {
      if(args[i].length > 1024) {
        arr.push(args[i].substr(0, 1024) + '...');
      }
      else {
        arr.push(args[i]);
      }
    }
    else if(typeof args[i] === 'number') {
      arr.push(args[i].toString());
    }
    else if(args[i] === undefined) {
      arr.push('[undefined]');
    }
    else if(args[i] === null) {
      arr.push('[null]');
    }
    else if(typeof args[i] === 'object') {
      arr.push('[object]');
    }
    if(typeof args[i] === 'function') {
      arr.push('[function]');
    }
  }

  return arr;
};
