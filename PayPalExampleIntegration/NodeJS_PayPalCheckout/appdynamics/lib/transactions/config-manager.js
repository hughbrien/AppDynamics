'use strict';


function ConfigManager(agent) {
  this.agent = agent;

  this.config = undefined;
}
exports.ConfigManager = ConfigManager;


ConfigManager.prototype.init = function() {
}


ConfigManager.prototype.getConfigVersion = function() {
	var self = this;

	var lastConfigVersion = -1;
  if(self.config && self.config['currentVersion']) {
    lastConfigVersion = parseInt(self.config['currentVersion']);
  }

  return lastConfigVersion;
}

function defaultConfig() {
  return { timestampSkew : 0 };
}

ConfigManager.prototype.updateConfig = function(configUpdate) {
	var self = this;

	if(!self.config) {
		self.config = defaultConfig();
	}

	if(configUpdate.command === 'RESET') {
		self.config = defaultConfig();
	}

	for(var prop in configUpdate) {
		self.config[prop] = configUpdate[prop];
	}

	self.agent.emit('configUpdated');
}


ConfigManager.prototype.getConfig = function() {
	return this.config;
}


ConfigManager.prototype.getConfigValue = function(path) {
	var self = this;

	var keys = path.split('.');

	var value = undefined;
	var obj = self.config;

	for(var i = 0; i < keys.length; i++) {
		obj = obj[keys[i]];
		if(i < keys.length - 1) {
		  if(!obj || typeof(obj) !== 'object') {
				return undefined;
			}
		}
		else {
			return obj;
		}
	}

	return undefined;
}


ConfigManager.prototype.convertListToMap = function(props) {
	var propsMap = {};

	if(!props) {
		return propsMap;
	}

	props.forEach(function(prop) {
		propsMap[prop.name] = prop.value;
	});

	return propsMap;
}
