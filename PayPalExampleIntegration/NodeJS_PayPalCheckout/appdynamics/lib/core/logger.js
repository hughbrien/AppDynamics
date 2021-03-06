'use strict';

var util = require('util');


function Logger(agent) {
  this.agent = agent;
}
exports.Logger = Logger;


Logger.prototype.init = function(debug) {
  this.debug = debug;
};


Logger.prototype.log = function(msg) {
  if(this.debug && msg) console.log('appdynamics v' + this.agent.version + ':', msg);
};


Logger.prototype.error = function(err) {
  if(this.debug && err) console.error('appdynamics v' + this.agent.version + ' error:', err, err.stack);
};


Logger.prototype.dump = function(obj) {
  if(this.debug) console.log(util.inspect(obj, false, 10, true));
};


Logger.prototype.message = function(msg) {
  util.log("\u001b[1;31mAppDynamics:\u001b[0m " + msg);
};


function currentTime() {
	var d = new Date();

  return (
  		pad(d.getDate(), 2) + '-' +
  		pad(d.getMonth(), 2) + '-' +
    	d.getFullYear() + ' ' +
    	pad(d.getHours(), 2) + ':' +
    	pad(d.getMinutes(), 2) + ':' +
    	pad(d.getSeconds(), 2));
}

function pad(n, width) {
	n = n + '';
	return n.length >= width ? n : new Array(width - n.length + 1).join('0') + n
}
